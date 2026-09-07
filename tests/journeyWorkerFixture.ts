import { computeJourneyJob, type JourneyJob, type JourneyReply } from '@/engines/worldgen/journeyComputation';

/** Real route algorithms with a controllable transport, independent from Vite worker URLs. */
export class JourneyWorkerFixture {
  static instances: JourneyWorkerFixture[] = [];
  static automatic = true;
  onmessage: ((event: MessageEvent<JourneyReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  job!: JourneyJob;
  terminated = false;
  constructor() { JourneyWorkerFixture.instances.push(this); }
  postMessage(job: JourneyJob) {
    this.job = structuredClone(job);
    if (JourneyWorkerFixture.automatic) queueMicrotask(() => { if (!this.terminated) this.run(); });
  }
  deliver(reply: JourneyReply) { this.onmessage?.({ data: reply } as MessageEvent<JourneyReply>); }
  run() { computeJourneyJob(this.job, reply => this.deliver(reply)); }
  terminate() { this.terminated = true; }
}

export function installJourneyWorkerFixture(automatic = true): () => void {
  const original = globalThis.Worker;
  JourneyWorkerFixture.instances = []; JourneyWorkerFixture.automatic = automatic;
  globalThis.Worker = JourneyWorkerFixture as unknown as typeof Worker;
  return () => { globalThis.Worker = original; JourneyWorkerFixture.instances = []; };
}
