const cron = require('node-cron');
const { query } = require('../db');
const { runFullSync } = require('../services/paychexSync');
const { retryFailedSubmission } = require('../services/paychexSubmit');
const { subtractBusinessDays } = require('../utils/businessDays');

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
        `SELECT paychex_period_id, submit_by_date::text AS submit_by_date, pay_date::text AS pay_date
         FROM pay_periods
         WHERE status = 'OPEN'
           AND submit_by_date >= CURRENT_DATE
           AND submit_by_date <= CURRENT_DATE + INTERVAL '3 days'`
      );

      for (const period of result.rows) {
        const internalDeadline = subtractBusinessDays(period.pay_date, 3);
        const message = `PAYROLL DEADLINE APPROACHING: Pay period ${period.paychex_period_id} due ${internalDeadline}`;
        await query(
          `INSERT INTO sync_log (sync_type, status, message)
           SELECT $1, $2, $3
           WHERE NOT EXISTS (
             SELECT 1 FROM sync_log
             WHERE sync_type = 'deadline_reminder'
               AND message LIKE $4
               AND ran_at >= CURRENT_DATE
           )`,
          ['deadline_reminder', 'WARNING', message, `%${period.paychex_period_id}%`]
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
