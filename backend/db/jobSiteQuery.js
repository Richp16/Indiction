const { query } = require('./index');

const JOB_SITE_BASE_COLUMNS =
  'id, name, job_code, address, contract_number, certified_payroll_count, is_active';

function isMissingColumn(error, columnName) {
  const message = String(error?.message || '');
  return message.includes(columnName);
}

function normalizeJobSiteRow(row) {
  return {
    ...row,
    wage_determination_no: row.wage_determination_no ?? '',
    start_date: row.start_date
      ? String(row.start_date).split('T')[0]
      : null,
  };
}

async function selectAllJobSites() {
  try {
    const result = await query(
      `SELECT ${JOB_SITE_BASE_COLUMNS},
              COALESCE(wage_determination_no, '') AS wage_determination_no,
              start_date::text AS start_date
       FROM job_sites
       ORDER BY name`
    );
    return result.rows.map(normalizeJobSiteRow);
  } catch (error) {
    if (isMissingColumn(error, 'start_date')) {
      const result = await query(
        `SELECT ${JOB_SITE_BASE_COLUMNS},
                COALESCE(wage_determination_no, '') AS wage_determination_no,
                NULL::text AS start_date
         FROM job_sites
         ORDER BY name`
      );
      return result.rows.map(normalizeJobSiteRow);
    }
    if (isMissingColumn(error, 'wage_determination_no')) {
      const result = await query(
        `SELECT ${JOB_SITE_BASE_COLUMNS},
                '' AS wage_determination_no,
                NULL::text AS start_date
         FROM job_sites
         ORDER BY name`
      );
      return result.rows.map(normalizeJobSiteRow);
    }
    throw error;
  }
}

async function selectJobSiteById(jobSiteId) {
  try {
    const result = await query(
      `SELECT id, name, job_code,
              COALESCE(wage_determination_no, '') AS wage_determination_no,
              start_date::text AS start_date
       FROM job_sites
       WHERE id = $1`,
      [jobSiteId]
    );
    return result.rows[0] ? normalizeJobSiteRow(result.rows[0]) : null;
  } catch (error) {
    if (isMissingColumn(error, 'start_date')) {
      const result = await query(
        `SELECT id, name, job_code,
                COALESCE(wage_determination_no, '') AS wage_determination_no,
                NULL::text AS start_date
         FROM job_sites
         WHERE id = $1`,
        [jobSiteId]
      );
      return result.rows[0] ? normalizeJobSiteRow(result.rows[0]) : null;
    }
    if (isMissingColumn(error, 'wage_determination_no')) {
      const result = await query(
        `SELECT id, name, job_code,
                '' AS wage_determination_no,
                NULL::text AS start_date
         FROM job_sites
         WHERE id = $1`,
        [jobSiteId]
      );
      return result.rows[0] ? normalizeJobSiteRow(result.rows[0]) : null;
    }
    throw error;
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
    if (!isMissingColumn(error, 'wage_determination_no')) throw error;
    return { wage_determination_no: '' };
  }
}

module.exports = {
  selectAllJobSites,
  selectJobSiteById,
  selectJobSiteWageDetermination,
  isMissingWageDeterminationColumn: (error) =>
    isMissingColumn(error, 'wage_determination_no'),
  normalizeJobSiteRow,
};
