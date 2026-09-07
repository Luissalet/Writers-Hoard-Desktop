import { testProjectHealthRecovery } from './projectHealthRecovery';

declare global {
  interface Window {
    __projectHealthRecoveryResult?: {
      ok: boolean;
      tests: string[];
      error?: string;
    };
  }
}

void testProjectHealthRecovery().then(
  (tests) => {
    window.__projectHealthRecoveryResult = { ok: true, tests };
  },
  (error: unknown) => {
    window.__projectHealthRecoveryResult = {
      ok: false,
      tests: [],
      error: error instanceof Error ? `${error.stack ?? error.message}` : String(error),
    };
  },
);
