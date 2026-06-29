const axios = require('axios');
const { query } = require('../db');
const { getToken } = require('./paychexAuth');

const baseUrl = () => process.env.PAYCHEX_BASE_URL;

const SUBMISSION_AGGREGATION_SQL = `
SELECT
  w.id                      AS worker_db_id,
  w.paychex_worker_id,
  w.first_name,
  w.last_name,
  js.paychex_job_id,
  te.paychex_component_id,
  SUM(te.hours)              AS total_hours,
  SUM(te.reimbursement_amount) AS total_reimbursement
FROM time_entries te
JOIN workers w    ON te.worker_id    = w.id
JOIN job_sites js ON te.job_site_id  = js.id
WHERE te.pay_period_id = $1
GROUP BY w.id, w.paychex_worker_id, w.first_name, w.last_name,
         js.paychex_job_id, te.paychex_component_id
`;

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
  rows,
  skipLog = false,
}) {
  let checkId = null;

  try {
    const checkResponse = await paychexPost(`/workers/${paychexWorkerId}/checks`, {
      payPeriodId: paychexPeriodId,
      checkCorrelationId: `${paychexWorkerId}-${paychexPeriodId}`,
    });

    checkId =
      checkResponse.checkId ||
      checkResponse.content?.[0]?.checkId ||
      checkResponse.paycheckId;

    for (const row of rows) {
      const baseBody = {
        componentId: row.paychex_component_id,
        effectOnPay: 'ADDITION',
        organization: { jobId: row.paychex_job_id },
        blockAutoDistribution: true,
      };

      const totalHours = parseFloat(row.total_hours) || 0;
      const totalReimbursement = parseFloat(row.total_reimbursement) || 0;

      if (totalHours > 0) {
        await paychexPost(`/checks/${checkId}/checkcomponents`, {
          ...baseBody,
          hours: totalHours,
        });
      }

      if (totalReimbursement > 0) {
        await paychexPost(`/checks/${checkId}/checkcomponents`, {
          ...baseBody,
          amount: totalReimbursement,
        });
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
  const aggResult = await query(SUBMISSION_AGGREGATION_SQL, [payPeriodId]);

  const byWorker = new Map();
  for (const row of aggResult.rows) {
    if (!byWorker.has(row.paychex_worker_id)) {
      byWorker.set(row.paychex_worker_id, {
        workerDbId: row.worker_db_id,
        paychexWorkerId: row.paychex_worker_id,
        workerName: `${row.first_name} ${row.last_name}`,
        rows: [],
      });
    }
    byWorker.get(row.paychex_worker_id).rows.push(row);
  }

  const results = [];
  for (const worker of byWorker.values()) {
    const result = await submitWorkerPayroll({
      payPeriodId,
      paychexPeriodId,
      submittedByUserId,
      workerDbId: worker.workerDbId,
      paychexWorkerId: worker.paychexWorkerId,
      workerName: worker.workerName,
      rows: worker.rows,
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
  const aggResult = await query(SUBMISSION_AGGREGATION_SQL, [logEntry.pay_period_id]);
  const workerRows = aggResult.rows.filter(
    (row) => row.worker_db_id === worker.id
  );

  const result = await submitWorkerPayroll({
    payPeriodId: logEntry.pay_period_id,
    paychexPeriodId: logEntry.paychex_period_id,
    submittedByUserId: logEntry.submitted_by,
    workerDbId: worker.id,
    paychexWorkerId: worker.paychex_worker_id,
    workerName: `${worker.first_name} ${worker.last_name}`,
    rows: workerRows,
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
    'SELECT * FROM pay_periods WHERE id = $1',
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
     HAVING COALESCE(SUM(te.hours), 0) = 0`,
    [payPeriodId]
  );

  for (const row of zeroHoursResult.rows) {
    issues.push({
      type: 'warning',
      message: 'Worker has zero total hours for this pay period',
      workerId: row.worker_id,
      workerName: `${row.first_name} ${row.last_name}`,
    });
  }

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
