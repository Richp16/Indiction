const { runPayPeriodSync, runReferenceDataSync } = require('./paychexSync');
const { isPaychexEnabled } = require('../middleware/paychexGuard');

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 4x/day

let syncInProgress = false;

async function runAllSyncsGuarded(reason = 'unknown') {
  if (!(await isPaychexEnabled())) {
    console.log(`[sync] Skipped (${reason}) — Paychex disabled`);
    return { skipped: true, paychexDisabled: true };
  }
  if (syncInProgress) {
    console.log(`[sync] Skipped (${reason}) — already running`);
    return { skipped: true };
  }
  syncInProgress = true;
  try {
    console.log(`[sync] Starting (${reason})...`);
    // Each individual sync catches its own errors — one failure does not
    // prevent the other tier (or sibling syncs within a tier) from running.
    const payPeriodResults = await runPayPeriodSync();
    const referenceResults = await runReferenceDataSync();
    console.log(`[sync] Completed (${reason})`);
    return { skipped: false, payPeriodResults, referenceResults };
  } catch (error) {
    console.error(`[sync] Failed (${reason}):`, error);
    return { skipped: false, error };
  } finally {
    syncInProgress = false;
  }
}

/** @deprecated Prefer runAllSyncsGuarded — kept for callers that still import the old name. */
async function runSyncIfNotAlreadyRunning(reason = 'unknown') {
  return runAllSyncsGuarded(reason);
}

function startScheduledSyncs() {
  isPaychexEnabled()
    .then((enabled) => {
      if (!enabled) {
        console.log('[sync] Scheduler not started — Paychex disabled');
        return;
      }
      console.log(
        `[sync] Scheduler armed: first run in 30s, then every ${SYNC_INTERVAL_MS}ms`
      );
      setTimeout(() => runAllSyncsGuarded('startup'), 30 * 1000);
      setInterval(() => runAllSyncsGuarded('interval'), SYNC_INTERVAL_MS);
    })
    .catch((error) => {
      console.error('[sync] Failed to start scheduler:', error.message);
    });
}

module.exports = {
  startScheduledSyncs,
  runAllSyncsGuarded,
  runSyncIfNotAlreadyRunning,
  SYNC_INTERVAL_MS,
};
