// Importing the registry registers every engine's anchor adapter and resolver, as the app does at start-up.
import '@/engines';
import { runSelfTest } from '@/services/aiBridge/selftest';

/** The bridge's own end-to-end self-test, run against a scratch project in the test database. */
export async function testBridgeSelfTest(): Promise<string> {
  const report = await runSelfTest({});
  const failed = report.checks.filter(check => !check.ok);
  if (failed.length) throw new Error(`Bridge self-test failed ${failed.length} check(s): ${failed.map(check => `${check.name} (${check.detail ?? ''})`).join('; ')}`);
  if (!report.cleanedUp) throw new Error('The self-test left its scratch project behind');
  return `AI bridge self-test: ${report.passed} checks passed, scratch project cleaned up`;
}
