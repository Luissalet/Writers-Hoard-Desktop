import { computeJourneyJob, type JourneyJob, type JourneyReply } from './journeyComputation';
const ctx = self as unknown as { postMessage(message: JourneyReply): void; onmessage: ((event: MessageEvent<JourneyJob>) => void) | null };
ctx.onmessage = event => {
  try { computeJourneyJob(event.data, reply => ctx.postMessage(reply)); }
  catch (error) { ctx.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
};
