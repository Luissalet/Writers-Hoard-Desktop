const DEFAULT_PREPARATION_MS = 15 * 60 * 1000;

function preparationTimeoutMs() {
  const value = process.env.WH_FOCUSED_PREP_TIMEOUT_MS;
  if (value === undefined) return DEFAULT_PREPARATION_MS;
  const milliseconds = Number(value);
  if (!Number.isInteger(milliseconds) || milliseconds < 1 || milliseconds > 3600000) {
    throw new Error('WH_FOCUSED_PREP_TIMEOUT_MS must be an integer from 1 to 3600000');
  }
  return milliseconds;
}

function startDeadline(label, initialPhase, timeoutMs, exit, reportProgress = false) {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  let phase = initialPhase;
  const report = () => console.log(`Focused browser ${label}: ${phase} (${elapsed()} ms elapsed)`);
  report();
  const progress = reportProgress ? setInterval(report, 30_000) : undefined;
  const timeout = setTimeout(() => {
    console.error(`Focused browser ${label} timed out while ${phase} (${elapsed()} ms elapsed; ${timeoutMs} ms budget)`);
    exit(1);
  }, timeoutMs);
  return {
    phase(next) {
      phase = next;
      if (reportProgress) report();
    },
    stop() {
      clearTimeout(timeout);
      clearInterval(progress);
      return elapsed();
    },
  };
}

module.exports = { preparationTimeoutMs, startDeadline };
