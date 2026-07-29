/**
 * Sync recurring reimbursement pay components from Paychex into local cache.
 *
 * Source of truth: GET /workers/{paychexWorkerId}/paycomponents
 * (worker-assigned components are recurring-on-check assignments).
 *
 * Filtering:
 * - If PAYCHEX_REIMBURSEMENT_COMPONENT_IDS is set (comma-separated), match those IDs.
 * - Otherwise fall back to reimbursement-like component names (reimburse, allowance, etc.).
 */

const { query } = require('../db');
const {
  isReimbursementComponentName,
  getConfiguredComponentId,
} = require('../config/paychex');
const { companyId } = require('../config/paychexApi');
const { paychexGet } = require('./paychexHttp');
const { formatSyncErrorForUser } = require('./paychexErrors');

function getReimbursementComponentIds() {
  const raw = process.env.PAYCHEX_REIMBURSEMENT_COMPONENT_IDS;
  if (raw && String(raw).trim()) {
    return String(raw)
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }

  // Single-ID fallback used by SPI / submit mapping.
  const single = getConfiguredComponentId('PAYCHEX_REIMBURSE_COMPONENT_ID');
  return single ? [single] : [];
}

function parseComponentAmount(component) {
  const raw =
    component.value ??
    component.amount ??
    component.rate ??
    component.unitRate ??
    null;
  if (raw == null || raw === '') return null;
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : null;
}

function getComponentId(component) {
  return (
    component.componentId ||
    component.payComponentId ||
    component.paychexComponentId ||
    component.id ||
    null
  );
}

function getComponentName(component) {
  return (
    component.name ||
    component.componentName ||
    component.description ||
    component.payComponentName ||
    ''
  );
}

/**
 * Worker paycomponents are recurring assignments. Skip explicit non-recurring
 * and deduction/reduction effects when those fields are present.
 */
function isRecurringEarningComponent(component) {
  if (component.recurring === false) return false;

  const effect = String(
    component.effectOnPay || component.effectonpay || component.classificationType || ''
  ).toUpperCase();
  if (
    effect.includes('REDUC') ||
    effect.includes('DEDUCT') ||
    effect === 'TAX' ||
    effect === 'WITHHOLDING'
  ) {
    return false;
  }

  return true;
}

function isTargetReimbursementComponent(component, configuredIds) {
  if (!isRecurringEarningComponent(component)) return false;

  const componentId = getComponentId(component);
  if (!componentId) return false;

  const amount = parseComponentAmount(component);
  if (amount == null || amount === 0) return false;

  if (configuredIds.length > 0) {
    return configuredIds.includes(String(componentId));
  }

  return isReimbursementComponentName(getComponentName(component));
}

function formatSyncError(error) {
  return formatSyncErrorForUser(error);
}

async function logSync(status, message) {
  await query(
    'INSERT INTO sync_log (sync_type, status, message) VALUES ($1, $2, $3)',
    ['recurring_reimbursements', status, message]
  );
}

/**
 * Admin debug: dump company pay components from Paychex.
 */
async function listCompanyPayComponents() {
  const cid = companyId();
  if (!cid) {
    const error = new Error('PAYCHEX_COMPANY_ID is not configured');
    error.statusCode = 500;
    throw error;
  }

  const components = await paychexGet(`/companies/${cid}/paycomponents`);
  return (Array.isArray(components) ? components : []).map((component) => ({
    componentId: getComponentId(component),
    name: getComponentName(component),
    effectOnPay: component.effectOnPay || component.effectonpay || null,
    classificationType: component.classificationType || null,
    calculationType: component.calculationType || null,
    startDate: component.startDate || null,
    raw: component,
  }));
}

async function syncRecurringReimbursementsForWorker(worker, configuredIds) {
  const components = await paychexGet(
    `/workers/${worker.paychex_worker_id}/paycomponents`,
    { workerId: worker.paychex_worker_id }
  );

  const list = Array.isArray(components) ? components : [];
  const matchedIds = [];
  let upserted = 0;

  for (const component of list) {
    if (!isTargetReimbursementComponent(component, configuredIds)) {
      continue;
    }

    const componentId = String(getComponentId(component));
    const amount = parseComponentAmount(component);
    const name = getComponentName(component) || null;
    matchedIds.push(componentId);

    await query(
      `INSERT INTO worker_recurring_reimbursements (
         worker_id,
         paychex_worker_id,
         paychex_pay_component_id,
         component_name,
         amount,
         recurring,
         last_synced_at
       ) VALUES ($1, $2, $3, $4, $5, true, now())
       ON CONFLICT (worker_id, paychex_pay_component_id)
       DO UPDATE SET
         paychex_worker_id = EXCLUDED.paychex_worker_id,
         component_name = EXCLUDED.component_name,
         amount = EXCLUDED.amount,
         recurring = true,
         last_synced_at = now()`,
      [worker.id, worker.paychex_worker_id, componentId, name, amount]
    );
    upserted += 1;
  }

  if (matchedIds.length === 0) {
    await query(
      `DELETE FROM worker_recurring_reimbursements WHERE worker_id = $1`,
      [worker.id]
    );
  } else {
    await query(
      `DELETE FROM worker_recurring_reimbursements
       WHERE worker_id = $1
         AND paychex_pay_component_id <> ALL($2::text[])`,
      [worker.id, matchedIds]
    );
  }

  return upserted;
}

/**
 * Pull recurring reimbursement amounts for all active mapped workers.
 * Failures for individual workers are logged and skipped so one bad worker
 * does not abort the whole run.
 */
async function syncRecurringReimbursementsForAllWorkers() {
  const configuredIds = getReimbursementComponentIds();

  try {
    const { rows: workers } = await query(
      `SELECT id, paychex_worker_id
       FROM workers
       WHERE is_active = true
         AND paychex_worker_id IS NOT NULL
         AND paychex_worker_id <> ''`
    );

    let upserted = 0;
    let workersWithReimb = 0;
    let workerErrors = 0;

    for (const worker of workers) {
      try {
        const count = await syncRecurringReimbursementsForWorker(worker, configuredIds);
        upserted += count;
        if (count > 0) workersWithReimb += 1;
      } catch (error) {
        workerErrors += 1;
        console.warn(
          `[recurring-reimb] Failed for worker ${worker.paychex_worker_id}:`,
          formatSyncError(error)
        );
      }
    }

    const message =
      `Synced ${upserted} recurring reimbursement row(s) across ` +
      `${workersWithReimb} worker(s)` +
      (workerErrors ? ` (${workerErrors} worker error(s))` : '') +
      (configuredIds.length
        ? `; filter IDs: ${configuredIds.join(',')}`
        : '; filter: reimbursement name heuristic');

    await logSync('SUCCESS', message);
    return {
      syncType: 'recurring_reimbursements',
      status: 'SUCCESS',
      message,
      upserted,
      workersWithReimb,
      workerErrors,
      configuredComponentIds: configuredIds,
    };
  } catch (error) {
    const detail = formatSyncError(error);
    const message = detail.message || error.message || 'Unknown error';
    console.error('[recurring-reimb] Sync failed:', detail);
    try {
      await logSync('FAILED', message);
    } catch {
      // ignore log failure
    }
    return {
      syncType: 'recurring_reimbursements',
      status: 'FAILED',
      message,
    };
  }
}

module.exports = {
  getReimbursementComponentIds,
  listCompanyPayComponents,
  syncRecurringReimbursementsForAllWorkers,
  isTargetReimbursementComponent,
  parseComponentAmount,
};
