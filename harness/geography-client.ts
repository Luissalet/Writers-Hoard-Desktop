// Full geography must be background, deduplicated and revision-safe.
import { requestGeographyBase, type GeographyWorkerFactory } from '../src/engines/worldgen/cartography/geographyClient';
import type { HumanGeography } from '../src/engines/worldgen/core/settlements';
import type { WorldData } from '../src/engines/worldgen/core/types';
import type { GeographyWorkerReply, GeographyWorkerRequest } from '../src/engines/worldgen/geography.worker';

const fakeGeo = (tag: string): HumanGeography => ({
  depth: 'full', settlements: [], roads: [], realms: [], realmOf: new Int32Array(4).fill(-1),
  features: [], ruins: [], landforms: [],
  languages: { proto: { id: `proto-${tag}`, name: tag, phonemes: [], syllables: [], lexicon: {} }, living: [] },
  languageOf: {},
}) as unknown as HumanGeography;

const fakeWorld = (seed: string, revision = 1) => ({
  width: 2, height: 2, revision,
  params: { seed }, painted: {},
}) as unknown as WorldData;

let spawns = 0;
function factory(delay: number): GeographyWorkerFactory {
  return () => {
    spawns++;
    let dead = false;
    const worker = {
      onmessage: null as ((event: MessageEvent<GeographyWorkerReply>) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      postMessage(message: GeographyWorkerRequest) {
        setTimeout(() => {
          if (dead) return;
          worker.onmessage?.({ data: {
            type: 'done', requestId: message.requestId, geography: fakeGeo(message.world.params.seed),
          } } as MessageEvent<GeographyWorkerReply>);
        }, delay);
      },
      terminate() { dead = true; },
    };
    return worker;
  };
}

let failed = false;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? '✓' : '✗'} ${label} · ${detail}`);
  if (!ok) failed = true;
};

const a = fakeWorld('worker-a');
const p1 = requestGeographyBase(a, 'full', undefined, factory(15));
const p2 = requestGeographyBase(a, 'full', undefined, factory(15));
const [g1, g2] = await Promise.all([p1, p2]);
check('dos consumidores comparten un solo cálculo', spawns === 1 && g1 === g2, `${spawns} worker`);
const g3 = await requestGeographyBase(a, 'full', undefined, factory(15));
check('la segunda entrada cobra la base en memoria', spawns === 1 && g3 === g1, `${spawns} worker`);

const b = fakeWorld('worker-b');
const old = requestGeographyBase(b, 'full', undefined, factory(80))
  .then(() => 'resolved', (error: unknown) => error instanceof DOMException ? error.name : 'error');
const c = fakeWorld('worker-c');
const fresh = requestGeographyBase(c, 'full', undefined, factory(5));
const [oldState, freshGeo] = await Promise.all([old, fresh]);
check('un mundo nuevo cancela el cálculo que ya no puede mostrarse', oldState === 'AbortError', oldState);
check('el resultado vigente sí aterriza', freshGeo.languages.proto.name === 'worker-c', freshGeo.languages.proto.name);

process.exit(failed ? 1 : 0);
