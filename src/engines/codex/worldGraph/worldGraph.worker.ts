import { buildWorldGraph } from './model';
import type { WorldGraphInput } from './types';

self.onmessage = (event: MessageEvent<WorldGraphInput>) => {
  try { self.postMessage({ graph: buildWorldGraph(event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
