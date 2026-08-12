const express = require('express');
const { requireRole } = require('../middleware/roleGuard');
const {
  generateJobCostingRows,
  getJobCostingSummary,
} = require('../services/jobCosting');
const { formatPeriodLabel } = require('../services/payrollPayPeriods');

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get('/', requireRole('system_admin', 'payroll_admin'), async (req, res) => {
  try {
    const payPeriodId = String(req.query.payPeriodId || '').trim();
    const jobSiteId = String(req.query.jobSiteId || '').trim();

    if (!payPeriodId || !UUID_RE.test(payPeriodId)) {
      return res.status(400).json({ message: 'payPeriodId must be a valid UUID' });
    }
    if (!jobSiteId || !UUID_RE.test(jobSiteId)) {
      return res.status(400).json({ message: 'jobSiteId must be a valid UUID' });
    }

    const result = await generateJobCostingRows(payPeriodId, jobSiteId);
    if (result.notFound === 'payPeriod') {
      return res.status(404).json({ message: 'Pay period not found' });
    }
    if (result.notFound === 'jobSite') {
      return res.status(404).json({ message: 'Job site not found' });
    }

    const summary = await getJobCostingSummary(payPeriodId, jobSiteId);
    const { payPeriod, jobSite, rows } = result;

    res.json({
      payPeriod: {
        id: payPeriod.id,
        start_date: payPeriod.start_date,
        end_date: payPeriod.end_date,
        startDate: payPeriod.start_date,
        endDate: payPeriod.end_date,
        label: formatPeriodLabel(payPeriod.start_date, payPeriod.end_date),
      },
      jobSite: {
        id: jobSite.id,
        name: jobSite.name,
        jobCode: jobSite.job_code,
      },
      rows,
      summary,
    });
  } catch (error) {
    console.error('[job-costing]', error.message);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
