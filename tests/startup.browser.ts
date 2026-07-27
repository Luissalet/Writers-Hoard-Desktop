import { db } from '@/db';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';

declare global {
  interface Window {
    __startupResult?: {
      ok: boolean;
      tests: string[];
      error?: string;
    };
  }
}

const runtimeErrors: string[] = [];

window.addEventListener('error', event => {
  runtimeErrors.push(event.error instanceof Error
    ? event.error.stack || event.error.message
    : event.message);
});
window.addEventListener('unhandledrejection', event => {
  runtimeErrors.push(
    event.reason instanceof Error
      ? event.reason.stack || event.reason.message
      : String(event.reason),
  );
});

async function runStartupSmoke(): Promise<void> {
  await db.delete();
  await db.open();
  const now = Date.now();
  await db.projects.add({
    id: 'startup-worldgen-project',
    title: 'Worldgen route fixture',
    mode: 'novelist',
    type: 'standalone',
    color: '#c4973b',
    description: '',
    status: 'draft',
    enabledEngines: ['worldgen'],
    engineOrder: ['worldgen'],
    createdAt: now,
    updatedAt: now,
  });
  await db.generatedWorlds.add({
    id: 'startup-world',
    projectId: 'startup-worldgen-project',
    title: 'Persisted route world',
    params: { ...DEFAULT_PARAMS, width: 64, plates: 4 },
    edits: '[]',
    regions: [],
    createdAt: now,
    updatedAt: now,
  });

  // The route regression happens before terrain is available. A dormant worker
  // keeps the fixture deterministic while still mounting the real persisted
  // Worldgen view and its lazy route.
  Object.defineProperty(window, 'Worker', {
    configurable: true,
    value: class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage(): void {}
      terminate(): void {}
    },
  });
  window.location.hash = '#/project/startup-worldgen-project/worldgen';
  await import('@/main');

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (runtimeErrors.length) throw new Error(runtimeErrors.join('\n'));
    const view = document.querySelector('[data-testid="worldgen-view"]');
    if (view && window.location.hash.includes('/worldgen')) {
      return;
    }
    await new Promise(resolve => window.setTimeout(resolve, 50));
  }
  throw new Error(
    `Persisted Worldgen route did not remain active (hash: ${window.location.hash}).`,
  );
}

void runStartupSmoke()
  .then(() => {
    window.__startupResult = {
      ok: true,
      tests: ['full renderer startup', 'persisted Worldgen route startup'],
    };
  })
  .catch(error => {
    window.__startupResult = {
      ok: false,
      tests: [],
      error: error instanceof Error ? error.stack || error.message : String(error),
    };
  });

export {};
