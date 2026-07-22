/**
 * Link operational `pay_periods` to synced `paychex_pay_periods` by date.
 *
 * Option A: reuse pay_periods.paychex_period_id when a catalog match is found.
 * Certified Payroll enrichment also exposes paychexPayPeriodId on API payloads
 * even when the DB column is left unchanged (unique constraint safety).
 */

const { query } = require('../db');
const { companyId: envCompanyId } = require('../config/paychexApi');
const { assertPaychexCompanyId } = require('./paychexIds');

function toDateOnly(value) {
  if (!value) return null;
  return String(value).split('T')[0];
}

function daysBetween(a, b) {
  const left = new Date(`${toDateOnly(a)}T00:00:00.000Z`);
  const right = new Date(`${toDateOnly(b)}T00:00:00.000Z`);
  return Math.abs(Math.round((left - right) / 86400000));
}

/**
 * Prefer exact end_date match, then ±1 day. Prefer COMPLETED status.
 */
function pickCatalogMatch(localEndDate, catalogRows) {
  const end = toDateOnly(localEndDate);
  if (!end || !catalogRows.length) return null;

  const scored = catalogRows
    .map((row) => {
      const catalogEnd = toDateOnly(row.end_date);
      if (!catalogEnd) return null;
      const dayDiff = daysBetween(end, catalogEnd);
      if (dayDiff > 1) return null;
      const statusBoost = String(row.status || '').toUpperCase() === 'COMPLETED' ? 0 : 10;
      return { row, score: dayDiff + statusBoost };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score);

  return scored[0]?.row || null;
}

async function loadCatalogPeriods(companyId) {
  const result = await query(
    `SELECT pay_period_id, status, start_date::text AS start_date, end_date::text AS end_date
     FROM paychex_pay_periods
     WHERE company_id = $1`,
    [companyId]
  );
  return result.rows;
}

async function loadLocalPayPeriods() {
  const result = await query(
    `SELECT id, paychex_period_id,
            start_date::text AS start_date,
            end_date::text AS end_date
     FROM pay_periods
     ORDER BY end_date DESC`
  );
  return result.rows;
}

/**
 * Find a paychex_pay_periods row for a local date window.
 */
async function findPaychexPayPeriodForDates({
  companyId,
  startDate,
  endDate,
} = {}) {
  const cid = assertPaychexCompanyId(companyId || envCompanyId());
  const catalog = await loadCatalogPeriods(cid);
  return pickCatalogMatch(endDate || startDate, catalog);
}

/**
 * Reconcile all local pay_periods against paychex_pay_periods for a company.
 * Updates pay_periods.paychex_period_id when a unique catalog match is found
 * and no other local row already owns that Paychex ID.
 */
async function reconcileLocalPayPeriodsToPaychex({ companyId } = {}) {
  const cid = assertPaychexCompanyId(companyId || envCompanyId());
  const [localPeriods, catalog] = await Promise.all([
    loadLocalPayPeriods(),
    loadCatalogPeriods(cid),
  ]);

  let matched = 0;
  let updated = 0;
  let alreadyLinked = 0;
  let skippedConflict = 0;
  let unmatched = 0;

  for (const local of localPeriods) {
    const catalogRow = pickCatalogMatch(local.end_date, catalog);
    if (!catalogRow) {
      unmatched += 1;
      continue;
    }

    matched += 1;
    const catalogId = String(catalogRow.pay_period_id);

    if (String(local.paychex_period_id) === catalogId) {
      alreadyLinked += 1;
      continue;
    }

    const owner = await query(
      `SELECT id FROM pay_periods
       WHERE paychex_period_id = $1 AND id <> $2
       LIMIT 1`,
      [catalogId, local.id]
    );

    if (owner.rows.length > 0) {
      skippedConflict += 1;
      console.warn('[PaychexReconcile] Skip update — paychex_period_id already owned', {
        localPayPeriodId: local.id,
        catalogPayPeriodId: catalogId,
        ownedBy: owner.rows[0].id,
      });
      continue;
    }

    await query(
      `UPDATE pay_periods
       SET paychex_period_id = $1
       WHERE id = $2`,
      [catalogId, local.id]
    );
    updated += 1;
  }

  console.log('[PaychexReconcile] Finished', {
    companyId: cid,
    localCount: localPeriods.length,
    catalogCount: catalog.length,
    matched,
    updated,
    alreadyLinked,
    skippedConflict,
    unmatched,
  });

  return {
    companyId: cid,
    localCount: localPeriods.length,
    catalogCount: catalog.length,
    matched,
    updated,
    alreadyLinked,
    skippedConflict,
    unmatched,
  };
}

/**
 * Enrich Certified Payroll / shared period options with catalog paychexPayPeriodId.
 * Does not change Daily Entry / Payroll selection logic — additive fields only.
 */
function enrichPeriodOptionsWithPaychexIds(periods, catalogRows) {
  return (periods || []).map((period) => {
    const catalogRow = pickCatalogMatch(period.endDate || period.end_date, catalogRows);
    const fromCatalog = catalogRow ? String(catalogRow.pay_period_id) : null;
    const fromLocal = period.paychexPeriodId || period.paychex_period_id || null;
    const paychexPayPeriodId = fromCatalog || fromLocal || null;

    return {
      ...period,
      displayLabel: period.label || period.displayLabel || null,
      paychexPayPeriodId,
      // Keep legacy key in sync for existing check-resolution paths.
      paychexPeriodId: paychexPayPeriodId || fromLocal,
    };
  });
}

async function enrichPeriodsWithCatalogIds(periods, companyId) {
  const cid = companyId || envCompanyId();
  if (!cid) {
    return enrichPeriodOptionsWithPaychexIds(periods, []);
  }
  const catalog = await loadCatalogPeriods(cid);
  return enrichPeriodOptionsWithPaychexIds(periods, catalog);
}

module.exports = {
  toDateOnly,
  daysBetween,
  pickCatalogMatch,
  findPaychexPayPeriodForDates,
  reconcileLocalPayPeriodsToPaychex,
  enrichPeriodOptionsWithPaychexIds,
  enrichPeriodsWithCatalogIds,
};
