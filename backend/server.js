require('dotenv').config();

const express = require('express');
const cors = require('cors');
const auth = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const workersRoutes = require('./routes/workers');
const jobSitesRoutes = require('./routes/jobSites');
const entriesRoutes = require('./routes/entries');
const summaryRoutes = require('./routes/summary');
const submitRoutes = require('./routes/submit');
const settingsRoutes = require('./routes/settings');
const usersRoutes = require('./routes/users');
const laborClassificationsRoutes = require('./routes/laborClassifications');
const companySettingsRoutes = require('./routes/companySettings');
const certifiedPayrollRoutes = require('./routes/certifiedPayroll');
const { startScheduledSyncs } = require('./services/paychexSyncScheduler');
const { checkPaychexConnectivity } = require('./services/paychexHttp');
const { startCronJobs } = require('./cron/jobs');
const { pool } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Allow the local dev frontend and an optional deployed frontend origin.
const allowedOrigins = ['http://localhost:5173'];

if (process.env.FRONTEND_ORIGIN) {
  allowedOrigins.push(process.env.FRONTEND_ORIGIN);
}

app.use(
  cors({
    origin: allowedOrigins,
    exposedHeaders: ['Content-Disposition'],
    credentials: true,
  })
);
app.use(express.json());

app.use('/api/auth', authRoutes);

app.use(auth);

app.use('/api/edit-locks', require('./routes/editLocks'));
app.use('/api/account', require('./routes/account'));
app.use('/api/workers', workersRoutes);
app.use('/api/job-sites', jobSitesRoutes);
app.use('/api/entries', entriesRoutes);
app.use('/api/summary', summaryRoutes);
app.get('/api/pay-periods/current', summaryRoutes.getCurrentPayPeriod);
app.get('/api/pay-periods/for-date', summaryRoutes.getPayPeriodForDate);
app.get('/api/alerts', summaryRoutes.getAlerts);
app.get(
  '/api/daily-entries/export',
  require('./middleware/roleGuard').requireRole('system_admin', 'payroll_admin'),
  summaryRoutes.exportMyEntriesCsv
);
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/job-costing', require('./routes/jobCosting'));
app.use('/api/submit', submitRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/labor-classifications', laborClassificationsRoutes);
app.use('/api/job-site-rates', require('./routes/jobSiteRates'));
app.use('/api/company-settings', companySettingsRoutes);
app.use('/api/certified-payroll', certifiedPayrollRoutes);
app.use('/api/paychex', require('./routes/paychex'));
app.use('/api/sync', require('./routes/sync'));
// Mount last: settings router is on /api and applies system_admin guard to all unmatched /api paths
app.use('/api', settingsRoutes);

async function startup() {
  // Log DATABASE_URL as seen by server.js at runtime.
  console.log('[startup] DATABASE_URL:', process.env.DATABASE_URL);

  // Basic DB connectivity check: run a simple SELECT 1 on startup.
  try {
    const result = await pool.query('SELECT 1 AS ok');
    console.log('[startup] DB connectivity OK, result:', result.rows[0]);
  } catch (error) {
    console.error('[startup] DB connectivity FAILED:', error);
  }

  // Existing Paychex connectivity check.
  const connectivity = await checkPaychexConnectivity();
  if (connectivity.ok) {
    console.log(`${connectivity.message} (baseURL: ${connectivity.baseUrl})`);
  } else {
    console.error(connectivity.message, connectivity.error);
  }

  // Existing scheduled syncs and cron jobs.
  startScheduledSyncs();
  startCronJobs();
}

startup();

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`FieldPay backend listening on port ${PORT}`);
  });
}
