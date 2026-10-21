// Explicit CPU QA; modelDirectory must contain the four pinned model assets.
const { Worker } = require('node:worker_threads');
const { build } = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const directory = process.argv[2]; if (!directory) throw Error('Pass an isolated prepared model directory');
  const output = path.resolve('work/entity-detection-qa'); fs.mkdirSync(output, { recursive: true });
  const workerFile = path.join(output, 'worker.cjs');
  await build({ entryPoints: ['electron/entityDetection/worker.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', packages: 'external', outfile: workerFile });
  const runs = [];
  for (let restart = 0; restart < 2; restart++) {
    const worker = new Worker(`globalThis.fetch=()=>{throw Error('NETWORK_BLOCKED')};require(${JSON.stringify(workerFile)});`, { eval: true, execArgv: [], workerData: { directory } });
    let sequence = 0; const pending = new Map();
    worker.on('message', message => { const job = pending.get(message.id); if (!job) return; pending.delete(message.id); if (message.error) job.reject(Error(message.error)); else job.resolve(message.result); });
    worker.on('error', error => { for (const job of pending.values()) job.reject(error); pending.clear(); });
    const detect = text => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); worker.postMessage({ id, action: 'detect', value: text }); });
    try {
      const texts = restart ? ['Élodie Durand regresó a Madrid.'] : [
        'María García viajó a San Sebastián para visitar la Universidad de Salamanca.',
        'Ada Lovelace met Alan Turing in New York at the United Nations.',
        '🧭 Élodie Durand llegó a Nueva York. 李明 vive en Madrid.',
        'Alma llegó a París. '.repeat(130) + 'María García visitó Nueva York.',
      ];
      for (const text of texts) {
        const started = Date.now(), spans = await detect(text);
        if (spans.some(span => text.slice(span.from, span.to) !== span.text)) throw Error('Incorrect source offsets');
        if (!spans.length || text.length > 200 && !spans.some(span => span.text === 'María García' && span.from > 2000)) throw Error('Missing expected entity or silent truncation');
        runs.push({ restart, text: text.length < 200 ? text : `Long text ${text.length} UTF-16 units`, milliseconds: Date.now() - started, spans });
      }
    } finally { await worker.terminate(); }
  }
  fs.writeFileSync(path.join(output, 'cpu-offline-real.json'), JSON.stringify({ network: 'fetch throws NETWORK_BLOCKED in every worker', runs }, null, 2));
  console.log(`PASS CPU multilingual NER, source offsets, full long document and fresh worker offline: ${runs.length} cases`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
