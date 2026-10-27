import { db } from '../src/db';
import { testWorldgenDomainWaypoints, trace as waypointTrace } from './worldgen-domain-waypoints.browser';
import { testWorldgenDomainMeasure, trace as measureTrace } from './worldgen-domain-measure.browser';
import { testWorldgenDomainWaypointAxis, trace as axisTrace } from './worldgen-domain-waypoint-axis.browser';
import { testWorldgenEraCacheCleanup, trace as cacheTrace } from './worldgen-era-cache-cleanup.browser';

declare global {
  interface Window {
    __domainWorkflowResult?: { ok: boolean; tests?: string[]; error?: string; traces: unknown[] };
  }
}

const traces = [waypointTrace, measureTrace, axisTrace, cacheTrace];
void (async () => {
  await testWorldgenDomainWaypoints();
  await testWorldgenDomainMeasure();
  await testWorldgenDomainWaypointAxis();
  await testWorldgenEraCacheCleanup();
  const tests = traces.flatMap(trace => (trace.checks as { name: string; passed: boolean }[]).map(check => {
    if (!check.passed) throw Error(check.name);
    return check.name;
  }));
  window.__domainWorkflowResult = { ok: true, tests, traces };
})().catch(error => {
  window.__domainWorkflowResult = { ok: false, error: error instanceof Error ? error.stack : String(error), traces };
}).finally(() => db.close());
