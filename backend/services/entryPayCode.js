const { query } = require('../db');
const {
  getPayCodeDefinition,
  isHoursPayCode,
  isReimbursementPayCode,
} = require('../config/paychex');

class EntryResolveError extends Error {
  constructor(message, statusCode = 422) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function resolveEntryPayFields({
  workerId,
  payCode,
  paychexComponentId,
  hours,
  reimbursementAmount,
}) {
  const workerResult = await query(
    'SELECT standard_rate, is_active FROM workers WHERE id = $1',
    [workerId]
  );

  if (workerResult.rows.length === 0) {
    throw new EntryResolveError('Worker not found', 404);
  }

  const worker = workerResult.rows[0];
  if (!worker.is_active || worker.standard_rate == null) {
    throw new EntryResolveError(
      'Worker is not eligible for payroll entry (no active pay rate)',
      422
    );
  }

  if (isHoursPayCode(payCode)) {
    const definition = getPayCodeDefinition(payCode);
    const hoursValue = Number(hours) || 0;
    if (hoursValue <= 0) {
      throw new EntryResolveError('Hours must be greater than zero for wage entries', 400);
    }

    return {
      paychexComponentId: payCode,
      componentName: definition.label,
      componentRate: worker.standard_rate ?? null,
      hours: hoursValue,
      reimbursementAmount: 0,
      entryType: 'HOURS',
    };
  }

  if (isReimbursementPayCode(payCode) || Number(reimbursementAmount) > 0) {
    const amount = Number(reimbursementAmount) || 0;
    if (amount <= 0) {
      throw new EntryResolveError('Reimbursement amount must be greater than zero', 400);
    }

    const reimburseDefinition = getPayCodeDefinition('REIMBURSE');
    let storedComponentId = 'REIMBURSE';
    let componentName = reimburseDefinition?.label || 'Reimbursement';

    const selectedComponentId =
      paychexComponentId ||
      (payCode && !isHoursPayCode(payCode) && payCode !== 'REIMBURSE' ? payCode : null);

    if (selectedComponentId) {
      storedComponentId = selectedComponentId;
      const compResult = await query(
        `SELECT name FROM worker_pay_components
         WHERE worker_id = $1 AND paychex_component_id = $2`,
        [workerId, selectedComponentId]
      );
      if (compResult.rows[0]?.name) {
        componentName = compResult.rows[0].name;
      }
    }

    return {
      paychexComponentId: storedComponentId,
      componentName,
      componentRate: null,
      hours: 0,
      reimbursementAmount: amount,
      entryType: 'REIMBURSEMENT',
    };
  }

  throw new EntryResolveError(
    'Invalid pay code: hours entries require REGULAR, OT, or PTO',
    400
  );
}

function getWeekBounds(dateStr) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  const day = date.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() + diffToMonday);
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  return {
    monday: monday.toISOString().split('T')[0],
    friday: friday.toISOString().split('T')[0],
  };
}

async function getWorkerWeeklyHours(workerId, entryDate, payPeriodId) {
  const { monday, friday } = getWeekBounds(entryDate);
  const result = await query(
    `SELECT COALESCE(SUM(hours_worked), 0) AS total_hours
     FROM daily_time_entries
     WHERE worker_id = $1
       AND pay_period_id = $2
       AND date_worked >= $3
       AND date_worked <= $4
       AND pay_code IN ('REGULAR', 'OT')`,
    [workerId, payPeriodId, monday, friday]
  );
  return Number(result.rows[0].total_hours);
}

module.exports = {
  resolveEntryPayFields,
  EntryResolveError,
  getWorkerWeeklyHours,
  getWeekBounds,
};
