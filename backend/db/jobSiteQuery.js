const { query } = require('./index');

const JOB_SITE_BASE_COLUMNS =
  'id, name, job_code, address, contract_number, certified_payroll_count, is_active';

function isMissingWageDeterminationColumn(error) {
  return String(error?.message || '').includes('wage_determination_no');
}

function normalizeJobSiteRow(row) {
  return {
    ...row,
    wage_determination_no: row.wage_determination_no ?? '',
  };
}

async function selectAllJobSites() {
  try {
    const result = await query(
      `SELECT ${JOB_SITE_BASE_COLUMNS},
              COALESCE(wage_determination_no, '') AS wage_determination_no
       FROM job_sites
       ORDER BY name`
    );
    return result.rows.map(normalizeJobSiteRow);
  } catch (error) {
    if (!isMissingWageDeterminationColumn(error)) throw error;
    const result = await query(
      `SELECT ${JOB_SITE_BASE_COLUMNS},
              '' AS wage_determination_no
       FROM job_sites
       ORDER BY name`
    );
    return result.rows.map(normalizeJobSiteRow);
  }
}

async function selectJobSiteById(jobSiteId) {
  try {
    const result = await query(
      `SELECT id, name, job_code,
              COALESCE(wage_determination_no, '') AS wage_determination_no
       FROM job_sites
       WHERE id = $1`,
      [jobSiteId]
    );
    return result.rows[0] ? normalizeJobSiteRow(result.rows[0]) : null;
  } catch (error) {
    if (!isMissingWageDeterminationColumn(error)) throw error;
    const result = await query(
      `SELECT id, name, job_code,
              '' AS wage_determination_no
       FROM job_sites
       WHERE id = $1`,
      [jobSiteId]
    );
    return result.rows[0] ? normalizeJobSiteRow(result.rows[0]) : null;
  }
}

async function selectJobSiteWageDetermination(jobSiteId) {
  try {
    const result = await query(
      `SELECT COALESCE(wage_determination_no, '') AS wage_determination_no
       FROM job_sites
       WHERE id = $1`,
      [jobSiteId]
    );
    return result.rows[0] ? normalizeJobSiteRow(result.rows[0]) : { wage_determination_no: '' };
  } catch (error) {
    if (!isMissingWageDeterminationColumn(error)) throw error;
    return { wage_determination_no: '' };
  }
}

module.exports = {
  selectAllJobSites,
  selectJobSiteById,
  selectJobSiteWageDetermination,
  isMissingWageDeterminationColumn,
  normalizeJobSiteRow,
};
