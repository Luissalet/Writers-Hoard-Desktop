// A Forge process that dies mid-job: the port closes, the main process sends
// the exit code, and the error the client sees carries it — whichever of the
// two arrives first.
//
//   xvfb-run -a npx electron scripts/run-focused-browser-tests.cjs \
//     tests/forge-exit-code.browser.ts testForgeExitCode 60000 --no-sandbox

import { FORGE_CLOSED_MESSAGE, forgeCrashExitCode, isForgeCrash, spawnForgeWorker } from '@/engines/worldgen/forge/bridge';
import { forgeCrashText, worldWorkspaceCopy } from '@/engines/worldgen/workspaceCopy';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type ExitOrder = 'close-first' | 'code-first' | 'no-code';

function stubForge(order: ExitOrder, code: number): void {
  (window as unknown as { whForge: unknown }).whForge = {
    available: true,
    memoryBytes: 8 * 1024 ** 3,
    spawn(_kind: string, token: string) {
      const channel = new MessageChannel();
      window.postMessage({ __forgePort: token }, '*', [channel.port1]);
      // The "process" answers once, so the watchdog is disarmed, then dies.
      channel.port2.postMessage({ type: 'progress' });
      window.setTimeout(() => {
        if (order === 'code-first') window.postMessage({ __forgeExit: token, code }, '*');
        window.setTimeout(() => {
          channel.port2.close();
          if (order === 'close-first') {
            window.setTimeout(() => window.postMessage({ __forgeExit: token, code }, '*'), 60);
          }
        }, 30);
      }, 30);
    },
  };
}

async function crashWith(order: ExitOrder, code: number): Promise<string> {
  stubForge(order, code);
  const worker = spawnForgeWorker('worldgen');
  return new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${order}: no error reported`)), 3000);
    worker.onerror = (event) => {
      window.clearTimeout(timer);
      resolve(event.message);
    };
    worker.postMessage({ type: 'generate' });
  });
}

export async function testForgeExitCode(): Promise<string[]> {
  const closeFirst = await crashWith('close-first', 134);
  assert(isForgeCrash(closeFirst) && forgeCrashExitCode(closeFirst) === 134, `close first: ${closeFirst}`);
  const codeFirst = await crashWith('code-first', -536870904);
  assert(forgeCrashExitCode(codeFirst) === -536870904, `code first: ${codeFirst}`);
  const noCode = await crashWith('no-code', 0);
  assert(noCode === FORGE_CLOSED_MESSAGE && forgeCrashExitCode(noCode) === null, `no code: ${noCode}`);

  const en = worldWorkspaceCopy('en');
  assert(forgeCrashText(en, 134).endsWith('Process exit code: 134.'), 'English text names the code');
  assert(forgeCrashText(en, null) === en.forgeCrashed, 'no code keeps the plain explanation');
  return [
    'A crashed Forge reports its exit code whether the port closes before or after the code arrives',
    'Without a code the plain crash message stands, and the overlay text names the code when there is one',
  ];
}
