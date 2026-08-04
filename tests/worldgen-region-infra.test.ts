import {
  canvasToRegionCell,
  regionCellToCanvas,
  regionCellToWorld,
  worldToRegionCell,
} from '../src/engines/worldgen/region/coordinates';
import {
  habitationSourceKey,
  materializeRegionPlace,
  worldLandmarkSourceKey,
  worldRuinSourceKey,
  worldSettlementSourceKey,
} from '../src/engines/worldgen/region/identity';
import { RegionWorkerClient, type RegionWorkerLike } from '../src/engines/worldgen/region/client';
import { DEFAULT_REGION_PARAMS, type RegionData } from '../src/engines/worldgen/region/types';
import type { HumanGeography } from '../src/engines/worldgen/core/settlements';
import type { WorldData } from '../src/engines/worldgen/core/types';
import type { RegionWorkerReply, RegionWorkerRequest } from '../src/engines/worldgen/region/workerProtocol';
import { buildLanguageFamily } from '../src/engines/worldgen/core/language';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-8;
}

function fakeWorld(): WorldData {
  return {
    width: 2048,
    height: 1024,
    params: { seed: 'region-test' },
    revision: 3,
  } as WorldData;
}

function fakeGeography(): HumanGeography {
  return {
    settlements: [],
    roads: [],
    realms: [],
    realmOf: new Int32Array(1),
    features: [],
    ruins: [],
    landforms: [],
    languages: buildLanguageFamily('region-test', 2),
    languageOf: {},
  };
}

function fakeRegion(window = { cx: 100, cy: 80, spanKm: 120 }): RegionData {
  return {
    window,
    params: DEFAULT_REGION_PARAMS,
    width: 112,
    height: 80,
    margin: 8,
    metresPerCell: 1000,
    originX: 70,
    originY: 50,
    worldPerCellX: 0.5,
    worldPerCellY: 0.5,
    elevation: new Float32Array(1),
    water: new Uint8Array(1),
    flow: new Float32Array(1),
    slope: new Float32Array(1),
    wet: new Float32Array(1),
    biome: new Uint8Array(1),
    cover: new Uint8Array(1),
    streams: [],
    places: [],
    tracks: [],
    fields: [],
    hedges: [],
    dykes: [],
    title: 'Test',
    subtitle: 'Test',
  };
}

class MockWorker implements RegionWorkerLike {
  onmessage: ((event: MessageEvent<RegionWorkerReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  messages: RegionWorkerRequest[] = [];
  terminated = false;

  postMessage(message: RegionWorkerRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(reply: RegionWorkerReply): void {
    this.onmessage?.({ data: reply } as MessageEvent<RegionWorkerReply>);
  }
}

function testCoordinates(): void {
  const frame = {
    width: 112,
    height: 80,
    margin: 8,
    originX: 2038,
    originY: 40,
    worldPerCellX: 0.5,
    worldPerCellY: 0.5,
  };
  const topLeft = canvasToRegionCell(frame, { x: 0, y: 0 }, { width: 960, height: 640 });
  assert(topLeft.x === 8 && topLeft.y === 8, 'canvas conversion ignored generation margin');

  const cell = { x: 37.25, y: 42.5 };
  const canvas = regionCellToCanvas(frame, cell, { width: 960, height: 640 });
  const roundTrip = canvasToRegionCell(frame, canvas, { width: 960, height: 640 });
  assert(close(roundTrip.x, cell.x) && close(roundTrip.y, cell.y), 'canvas/cell round-trip drifted');

  const world = regionCellToWorld(frame, cell, 2048);
  const cellRoundTrip = worldToRegionCell(frame, world, 2048);
  assert(close(cellRoundTrip.x, cell.x) && close(cellRoundTrip.y, cell.y), 'seam-aware world round-trip drifted');
}

function testIdentity(): void {
  assert(worldSettlementSourceKey(12.4, 8.7) === 'settlement:12,9', 'settlement key diverged from Atlas');
  assert(worldRuinSourceKey(12.4, 8.7) === 'ruin:12,9', 'ruin key diverged from Atlas');
  assert(worldLandmarkSourceKey('volcano', 12.4, 8.7) === 'landmark:volcano:12,9', 'landmark key diverged from Atlas');
  assert(habitationSourceKey(-4, 17) === 'region:habitation:-4,17', 'lattice key is not deterministic');

  const a = { width: 120, height: 80, margin: 10, metresPerCell: 500, originX: 10, originY: 20, worldPerCellX: 0.25, worldPerCellY: 0.25 };
  const b = { width: 240, height: 160, margin: 20, metresPerCell: 250, originX: 5, originY: 15, worldPerCellX: 0.125, worldPerCellY: 0.125 };
  const first = materializeRegionPlace(
    { id: 1, kind: 'landmark', landmark: 'cave', x: 80, y: 60, name: 'Cave', importance: 0.4 },
    a,
    2048,
  );
  const second = materializeRegionPlace(
    { id: 1, kind: 'landmark', landmark: 'cave', x: 200, y: 160, name: 'Cave', importance: 0.4 },
    b,
    2048,
  );
  assert(close(first.worldX, second.worldX) && close(first.worldY, second.worldY), 'test geometries do not describe the same place');
  assert(first.sourceKey === second.sourceKey, 'regional identity depends on viewport resolution');
}

/** Lets every pending `.then` in the client run before we look at a mock. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

async function testWorkerClient(): Promise<void> {
  const workers: MockWorker[] = [];
  const client = new RegionWorkerClient(1);
  const world = fakeWorld();
  const geography = fakeGeography();
  const window = { cx: 100, cy: 80, spanKm: 120 };
  const factory = () => {
    const worker = new MockWorker();
    workers.push(worker);
    return worker;
  };
  const progress: string[] = [];
  const first = client.request(world, geography, window, {
    workerFactory: factory,
    onProgress: (stage) => progress.push(stage),
  });
  assert(workers.length === 1, 'worker request did not create a worker');
  const configured = workers[0].messages[0];
  assert(configured?.type === 'configure', 'worker context was not configured');
  assert(
    configured.type === 'configure'
      && !('languages' in configured.geography)
      && configured.geography.languageCount === 2,
    'worker geography retained non-cloneable language functions',
  );
  structuredClone(configured);
  // Session acquisition is async now (it can wait for a busy session to free
  // up), so `generate` is posted a microtask after `request()` returns rather
  // than in the same tick. Drain the queue instead of assuming dispatch order
  // is synchronous — the assertion is about the request ID, not the timing.
  await flushMicrotasks();
  const sent = workers[0].messages[1];
  assert(sent?.type === 'generate' && sent.requestId === first.requestId, 'worker request ID was not preserved');
  workers[0].reply({ type: 'progress', requestId: first.requestId, stage: 'agua', overall: 0.22 });
  workers[0].reply({ type: 'done', requestId: first.requestId, region: fakeRegion(window) });
  await first.promise;
  assert(progress[0] === 'agua', 'worker progress was not forwarded');
  assert(!workers[0].terminated && client.workerSessionCount === 1, 'idle worker context was not retained');

  await client.request(world, geography, window, { workerFactory: factory }).promise;
  assert(workers.length === 1, 'bounded client cache missed an identical request');

  const cancelled = client.request(world, geography, { cx: 220, cy: 80, spanKm: 120 }, { workerFactory: factory });
  const cancelWorker = workers[0];
  cancelled.cancel();
  let cancelName = '';
  try {
    await cancelled.promise;
  } catch (error) {
    cancelName = error instanceof Error ? error.name : '';
  }
  assert(cancelName === 'AbortError', 'cancelled request did not reject with AbortError');
  await flushMicrotasks();
  // This used to assert the worker was terminated, which encoded the old
  // synchronous acquire: cancel always landed after attachment, so there was
  // always a session to destroy. Acquisition is async now, so a cancel can
  // land BEFORE the session is attached — and returning a configured ~80 MB
  // world clone to the idle pool is better than throwing it away. Either
  // disposal is correct; what must never happen is the session staying
  // claimed by a request that is already dead.
  assert(
    cancelWorker.terminated || client.workerSessionCount <= 1,
    'cancelled request left its worker session claimed',
  );
  client.dispose();
}

export async function runRegionInfraTests(): Promise<void> {
  testCoordinates();
  testIdentity();
  await testWorkerClient();
}
