const { runPayPeriodSync, runReferenceDataSync } = require('./paychexSync');

const SYNC_INTERVAL_MS =
  Number(process.env.PAYCHEX_SYNC_INTERVAL_MS) || 6 * 60 * 60 * 1000; // 4x/day

let syncInProgress = false;

async function runAllSyncsGuarded(reason = 'unknown') {
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
  console.log(
    `[sync] Scheduler armed: first run in 30s, then every ${SYNC_INTERVAL_MS}ms`
  );
  setTimeout(() => runAllSyncsGuarded('startup'), 30 * 1000);
  setInterval(() => runAllSyncsGuarded('interval'), SYNC_INTERVAL_MS);
}

module.exports = {
  startScheduledSyncs,
  runAllSyncsGuarded,
  runSyncIfNotAlreadyRunning,
  SYNC_INTERVAL_MS,
};
