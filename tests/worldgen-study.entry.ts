import { db } from '@/db';
import { testWorldgenStudy } from './worldgen-study.browser';
declare global {
  interface Window { __worldgenResult?: { ok: boolean; tests?: string[]; error?: string }; }
}
void testWorldgenStudy().then(tests => { window.__worldgenResult = { ok: true, tests }; })
  .catch(error => { window.__worldgenResult = { ok: false, error: error instanceof Error ? error.stack : String(error) }; })
  .finally(() => db.close());
