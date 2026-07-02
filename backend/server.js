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
const { runFullSync } = require('./services/paychexSync');
const { startCronJobs } = require('./cron/jobs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: 'http://localhost:5173',
  })
);
app.use(express.json());

app.use('/api/auth', authRoutes);

app.use(auth);

app.use('/api/workers', workersRoutes);
app.use('/api/job-sites', jobSitesRoutes);
app.use('/api/entries', entriesRoutes);
app.use('/api/summary', summaryRoutes);
app.get('/api/pay-periods/current', summaryRoutes.getCurrentPayPeriod);
app.get('/api/alerts', summaryRoutes.getAlerts);
app.use('/api/submit', submitRoutes);
app.use('/api', settingsRoutes);

async function startup() {
  try {
    const results = await runFullSync();
    console.log('Initial Paychex sync completed:', results);
  } catch (error) {
    console.error('Initial Paychex sync failed:', error.message);
  }

  startCronJobs();
}

startup();

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`FieldPay backend listening on port ${PORT}`);
  });
}
