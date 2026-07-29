const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../middleware/roleGuard');

const router = express.Router();

/**
 * GET /api/sync/status
 * Latest sync_log row per sync_type, plus failure summary for admin banner.
 */
router.get(
  '/status',
  requireRole('system_admin', 'payroll_admin'),
  async (_req, res) => {
    try {
      const latest = await query(
        `SELECT DISTINCT ON (sync_type)
           sync_type,
           status,
           message,
           ran_at AS created_at
         FROM sync_log
         ORDER BY sync_type, ran_at DESC`
      );

      const rows = latest.rows;
      const failures = rows.filter((r) => r.status === 'FAILED');
      const hasFailures = failures.length > 0;

      // Escalate styling when the same sync_type failed on consecutive attempts.
      let persistentFailure = false;
      if (hasFailures) {
        for (const failure of failures) {
          const history = await query(
            `SELECT status
             FROM sync_log
             WHERE sync_type = $1
             ORDER BY ran_at DESC
             LIMIT 2`,
            [failure.sync_type]
          );
          if (
            history.rows.length >= 2 &&
            history.rows.every((r) => r.status === 'FAILED')
          ) {
            persistentFailure = true;
            break;
          }
        }
      }

      res.json({
        syncs: rows,
        hasFailures,
        persistentFailure,
        failures: failures.map((f) => ({
          syncType: f.sync_type,
          message: f.message,
          at: f.created_at,
        })),
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

module.exports = router;
