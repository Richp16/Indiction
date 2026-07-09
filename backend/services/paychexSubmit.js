const axios = require('axios');
const { query } = require('../db');
const { getToken } = require('./paychexAuth');
const {
  buildHoursEarningPayload,
  buildReimbursementEarningPayload,
} = require('./paychexEarnings');
const { buildSubmissionPayload, validateExportConfig } = require('./paychexApiPayload');

const baseUrl = () => process.env.PAYCHEX_BASE_URL;

async function paychexPost(path, body) {
  const token = await getToken();
  const response = await axios.post(`${baseUrl()}${path}`, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  return response.data;
}

async function logSubmission({
  payPeriodId,
  submittedBy,
  workerId,
  status,
  paychexCheckId,
  errorMessage,
  retryCount,
}) {
  await query(
    `INSERT INTO submission_log
       (pay_period_id, submitted_by, worker_id, status, paychex_check_id, error_message, retry_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      payPeriodId,
      submittedBy,
      workerId,
      status,
      paychexCheckId || null,
      errorMessage || null,
      retryCount ?? 0,
    ]
  );
}

async function submitWorkerPayroll({
  payPeriodId,
  paychexPeriodId,
  submittedByUserId,
  workerDbId,
  paychexWorkerId,
  workerName,
  lines,
  skipLog = false,
}) {
  let checkId = null;

  try {
    const checkResponse = await paychexPost(`/workers/${paychexWorkerId}/checks`, {
      payPeriodId: paychexPeriodId,
      checkCorrelationId: `${paychexWorkerId}-${paychexPeriodId}`,
      blockAutoDistribution: true,
    });

    checkId =
      checkResponse.checkId ||
      checkResponse.content?.[0]?.checkId ||
      checkResponse.paycheckId;

    for (const line of lines) {
      if (line.entryType === 'HOURS' && line.totalHours > 0) {
        const hoursPayload = buildHoursEarningPayload({
          componentId: line.paychexComponentId,
          jobId: line.job_code,
          payHours: line.totalHours,
        });
        await paychexPost(`/checks/${checkId}/paycomponents`, hoursPayload);
      }

      if (line.entryType === 'REIMBURSEMENT' && line.totalReimbursement > 0) {
        const reimbPayload = buildReimbursementEarningPayload({
          componentId: line.paychexComponentId,
          jobId: line.job_code,
          payAmount: line.totalReimbursement,
        });
        await paychexPost(`/checks/${checkId}/paycomponents`, reimbPayload);
      }
    }

    if (!skipLog) {
      await logSubmission({
        payPeriodId,
        submittedBy: submittedByUserId,
        workerId: workerDbId,
        status: 'SUCCESS',
        paychexCheckId: checkId,
      });
    }

    return {
      workerDbId,
      workerName,
      status: 'SUCCESS',
      checkId,
      error: null,
    };
  } catch (error) {
    const errorMessage =
      error.response?.data?.message ||
      error.response?.data?.description ||
      error.message;

    if (!skipLog) {
      await logSubmission({
        payPeriodId,
        submittedBy: submittedByUserId,
        workerId: workerDbId,
        status: 'FAILED',
        paychexCheckId: checkId,
        errorMessage,
      });
    }

    return {
      workerDbId,
      workerName,
      status: 'FAILED',
      checkId,
      error: errorMessage,
    };
  }
}

async function submitPayroll(payPeriodId, submittedByUserId) {
  const periodResult = await query(
    'SELECT paychex_period_id FROM pay_periods WHERE id = $1',
    [payPeriodId]
  );

  if (periodResult.rows.length === 0) {
    throw new Error('Pay period not found');
  }

  const paychexPeriodId = periodResult.rows[0].paychex_period_id;
  const { workers, configErrors } = await buildSubmissionPayload(payPeriodId);

  if (configErrors.length > 0) {
    const summary = configErrors.map((e) => e.message).join('; ');
    throw new Error(`Export configuration error: ${summary}`);
  }

  const results = [];
  for (const worker of workers) {
    if (worker.lines.length === 0) {
      continue;
    }

    const result = await submitWorkerPayroll({
      payPeriodId,
      paychexPeriodId,
      submittedByUserId,
      workerDbId: worker.workerDbId,
      paychexWorkerId: worker.paychexWorkerId,
      workerName: worker.workerName,
      lines: worker.lines,
    });
    results.push(result);
  }

  const allSucceeded = results.length > 0 && results.every((r) => r.status === 'SUCCESS');
  const anyFailed = results.some((r) => r.status === 'FAILED');

  if (results.length === 0) {
    await query(
      "UPDATE pay_periods SET status = 'SUBMITTED' WHERE id = $1",
      [payPeriodId]
    );
  } else if (allSucceeded) {
    await query(
      "UPDATE pay_periods SET status = 'SUBMITTED' WHERE id = $1",
      [payPeriodId]
    );
  } else if (anyFailed) {
    await query(
      "UPDATE pay_periods SET status = 'PARTIAL' WHERE id = $1",
      [payPeriodId]
    );
  }

  return results;
}

async function retryFailedSubmission(submissionLogId) {
  const logResult = await query(
    `SELECT sl.*, pp.paychex_period_id
     FROM submission_log sl
     JOIN pay_periods pp ON sl.pay_period_id = pp.id
     WHERE sl.id = $1`,
    [submissionLogId]
  );

  if (logResult.rows.length === 0) {
    throw new Error('Submission log entry not found');
  }

  const logEntry = logResult.rows[0];
  const workerResult = await query(
    'SELECT id, paychex_worker_id, first_name, last_name FROM workers WHERE id = $1',
    [logEntry.worker_id]
  );

  if (workerResult.rows.length === 0) {
    throw new Error('Worker not found for retry');
  }

  const worker = workerResult.rows[0];
  const { workers, configErrors } = await buildSubmissionPayload(logEntry.pay_period_id);

  if (configErrors.length > 0) {
    const summary = configErrors.map((e) => e.message).join('; ');
    throw new Error(`Export configuration error: ${summary}`);
  }

  const workerPayload = workers.find((w) => w.workerDbId === worker.id);
  if (!workerPayload || workerPayload.lines.length === 0) {
    throw new Error('No exportable entries found for worker retry');
  }

  const result = await submitWorkerPayroll({
    payPeriodId: logEntry.pay_period_id,
    paychexPeriodId: logEntry.paychex_period_id,
    submittedByUserId: logEntry.submitted_by,
    workerDbId: worker.id,
    paychexWorkerId: worker.paychex_worker_id,
    workerName: `${worker.first_name} ${worker.last_name}`,
    lines: workerPayload.lines,
    skipLog: true,
  });

  await query(
    `UPDATE submission_log
     SET retry_count = retry_count + 1,
         status = $1,
         paychex_check_id = $2,
         error_message = $3,
         submitted_at = now()
     WHERE id = $4`,
    [result.status, result.checkId, result.error, submissionLogId]
  );

  return result;
}

async function validatePayroll(payPeriodId) {
  const issues = [];

  const periodResult = await query(
    `SELECT
       id,
       paychex_period_id,
       start_date::text,
       end_date::text,
       submit_by_date::text,
       pay_date::text,
       status,
       week1_start::text,
       week1_end::text,
       week2_start::text,
       week2_end::text
     FROM pay_periods WHERE id = $1`,
    [payPeriodId]
  );

  if (periodResult.rows.length === 0) {
    issues.push({ type: 'error', message: 'Pay period not found' });
    return issues;
  }

  const period = periodResult.rows[0];

  if (period.status !== 'OPEN') {
    issues.push({
      type: 'error',
      message: `Pay period status is ${period.status}, expected OPEN`,
    });
  }

  const today = new Date().toISOString().split('T')[0];
  if (period.submit_by_date <= today) {
    issues.push({
      type: 'error',
      message: `Submit-by date (${period.submit_by_date}) is today or in the past`,
    });
  }

  const outOfRangeResult = await query(
    `SELECT w.id AS worker_id, w.first_name, w.last_name, te.entry_date
     FROM time_entries te
     JOIN workers w ON te.worker_id = w.id
     WHERE te.pay_period_id = $1
       AND (te.entry_date < $2 OR te.entry_date > $3)`,
    [payPeriodId, period.start_date, period.end_date]
  );

  for (const row of outOfRangeResult.rows) {
    issues.push({
      type: 'error',
      message: `Entry date ${row.entry_date} is outside pay period range (${period.start_date} to ${period.end_date})`,
      workerId: row.worker_id,
      workerName: `${row.first_name} ${row.last_name}`,
    });
  }

  const zeroHoursResult = await query(
    `SELECT w.id AS worker_id, w.first_name, w.last_name
     FROM time_entries te
     JOIN workers w ON te.worker_id = w.id
     WHERE te.pay_period_id = $1
     GROUP BY w.id, w.first_name, w.last_name
     HAVING COALESCE(SUM(te.hours), 0) = 0
       AND COALESCE(SUM(te.reimbursement_amount), 0) = 0`,
    [payPeriodId]
  );

  for (const row of zeroHoursResult.rows) {
    issues.push({
      type: 'warning',
      message: 'Worker has zero total hours and reimbursements for this pay period',
      workerId: row.worker_id,
      workerName: `${row.first_name} ${row.last_name}`,
    });
  }

  const exportConfigIssues = await validateExportConfig(payPeriodId);
  issues.push(...exportConfigIssues);

  const syncResult = await query(
    `SELECT MAX(ran_at) AS last_sync
     FROM sync_log
     WHERE sync_type IN ('workers', 'pay_components', 'job_sites', 'pay_periods')
       AND status = 'SUCCESS'`
  );

  const lastSync = syncResult.rows[0]?.last_sync;
  if (lastSync) {
    const hoursSinceSync = (Date.now() - new Date(lastSync).getTime()) / (1000 * 60 * 60);
    if (hoursSinceSync > 24) {
      issues.push({
        type: 'warning',
        message: `Last successful sync was ${Math.floor(hoursSinceSync)} hours ago`,
      });
    }
  } else {
    issues.push({
      type: 'warning',
      message: 'No successful sync has been recorded',
    });
  }

  return issues;
}

module.exports = { submitPayroll, validatePayroll, retryFailedSubmission };
