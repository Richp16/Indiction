const cron = require('node-cron');
const { query } = require('../db');
const { runFullSync } = require('../services/paychexSync');
const { retryFailedSubmission } = require('../services/paychexSubmit');

function startCronJobs() {
  cron.schedule('0 6 * * *', async () => {
    try {
      const results = await runFullSync();
      console.log('[cron] Daily sync completed:', results);
    } catch (error) {
      console.error('[cron] Daily sync failed:', error.message);
    }
  });

  cron.schedule('0 8 * * *', async () => {
    try {
      const result = await query(
        `SELECT paychex_period_id, submit_by_date
         FROM pay_periods
         WHERE status = 'OPEN'
           AND submit_by_date <= CURRENT_DATE + INTERVAL '2 days'`
      );

      for (const period of result.rows) {
        const message = `PAYROLL DEADLINE APPROACHING: Pay period ${period.paychex_period_id} due ${period.submit_by_date}`;
        await query(
          'INSERT INTO sync_log (sync_type, status, message) VALUES ($1, $2, $3)',
          ['deadline_reminder', 'WARNING', message]
        );
        console.log('[cron]', message);
      }
    } catch (error) {
      console.error('[cron] Deadline reminder failed:', error.message);
    }
  });

  cron.schedule('*/30 * * * *', async () => {
    try {
      const result = await query(
        `SELECT id FROM submission_log
         WHERE status = 'FAILED' AND retry_count < 3`
      );

      for (const row of result.rows) {
        try {
          await retryFailedSubmission(row.id);
          console.log(`[cron] Retried submission ${row.id}`);
        } catch (error) {
          console.error(`[cron] Retry failed for submission ${row.id}:`, error.message);
        }
      }
    } catch (error) {
      console.error('[cron] Retry job failed:', error.message);
    }
  });

  console.log('Cron jobs scheduled');
}

module.exports = { startCronJobs };
