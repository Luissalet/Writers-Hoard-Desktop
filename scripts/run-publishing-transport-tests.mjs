// CAS1 regressions: real service, explicit request phases, actual concurrent worker/ASGI owner.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'writer-transport-regression-'));
const bundle = path.join(temp, 'service.cjs');
await build({ entryPoints: [path.join(root, 'electron/publishing/service.ts')], outfile: bundle,
  bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' });
const { PublishingService } = createRequire(import.meta.url)(bundle);
const peer = path.join(temp, 'loss.cjs');
await writeFile(peer, `const fs=require('node:fs');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line), reply=result=>process.stdout.write(JSON.stringify({id:m.id,ok:true,result})+'\\n');
 if(m.op==='init')reply({pid:process.pid});
 else if(m.op==='set')reply({enabled:m.enabled});
 else if(m.op==='shutdown'){reply({});process.exit(0);}
 else {fs.writeFileSync(process.argv[2],JSON.stringify({applied:true,request:m}));
  if(process.argv[3]==='reply-error')process.stdout.write(JSON.stringify({id:m.id,ok:false,error:'ASGI did not complete a response'})+'\\n');
  else process.exit(17);}
});`);
const instances = [];
function service(name, command, args, cwd = root) {
  const instance = new PublishingService({ configFile: path.join(temp, name + '.json'), dataDir: path.join(temp, name), command, args, cwd });
  instances.push(instance);
  return instance;
}
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Synthetic protocol did not complete')), 10000); })]); }
  finally { clearTimeout(timer); }
}
try {
  for (const [name, tool, args, uncertain, mode] of [
    ['mutation', 'deadline_add', { title: 'Synthetic retained write', date: '2030-01-01', kind: 'other' }, true],
    ['read', 'docs_list', {}, false],
    ['native-response-lost', 'deadline_add', {}, true, 'reply-error'],
    ['native-read-error', 'docs_list', {}, false, 'reply-error'],
  ]) {
    const marker = path.join(temp, name + '-applied.json');
    const instance = service(name, process.execPath, [peer, marker, mode || 'exit']);
    await instance.setModule('paperwork', true);
    const result = await instance.tool(tool, args);
    assert.equal(JSON.parse(await readFile(marker, 'utf8')).applied, true);
    assert.equal(result.code, uncertain ? 'outcome_unknown' : 'publishing-unavailable');
    assert.equal(Boolean(result.outcome_unknown), uncertain);
    if (uncertain) assert.equal(result.reconcile_action, 'read_current_state_before_retry');
  }
  const missing = service('before-send', path.join(temp, 'missing-worker.exe'), []);
  const result = await missing.tool('deadline_add', {});
  assert.equal(result.code, 'publishing-unavailable');
  assert.equal(Boolean(result.outcome_unknown), false);

  const python = path.join(root, 'publishing/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const worker = path.join(root, 'tests/fixtures/publishing_retained_worker.py');
  for (const action of ['consumer-cancel', 'module-off', 'held-off', 'service-close', 'worker-disconnect']) {
    const instance = service(action, python, [worker]);
    await instance.setModule('library', true);
    await instance.setModule('paperwork', true);
    const response = await bounded(instance.stream('GET', '/paperwork/retained', { range: 'bytes=1-3' }));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 1-3/4');
    const reader = response.body.getReader();
    assert.equal(Buffer.from((await bounded(reader.read())).value).toString(), 'abc');
    // Retaining a Range response never blocks another module or the shared protocol.
    const other = await bounded(instance.request('GET', '/library/api/health'));
    assert.equal(JSON.parse(Buffer.from(other.base64, 'base64')).module, 'library');
    if (action === 'consumer-cancel') await bounded(reader.cancel());
    if (action === 'worker-disconnect') {
      // Close only this synthetic worker's input. Its real shutdown path must cancel/drain ASGI.
      const exited = new Promise(resolve => instance.child.once('exit', resolve));
      instance.child.stdin.end();
      await assert.rejects(bounded(reader.read()));
      await bounded(exited);
    }
    if (action === 'service-close') await bounded(instance.close());
    else if (action === 'held-off') {
      await writeFile(path.join(temp, action, 'hold-shutdown'), 'hold');
      const off = instance.setModule('paperwork', false);
      try {
        await bounded((async () => {
          for (;;) {
            try { await readFile(path.join(temp, action, 'shutdown-entered')); break; }
            catch { await new Promise(resolve => setTimeout(resolve, 10)); }
          }
        })());
        const duringClose = await bounded(instance.request('GET', '/library/api/health'));
        assert.equal(duringClose.status, 200);
      } finally {
        await writeFile(path.join(temp, action, 'release-shutdown'), 'release');
      }
      await bounded(off);
      await bounded(instance.setModule('library', false));
    }
    else {
      await bounded(instance.setModule('paperwork', false));
      await bounded(instance.setModule('library', false));
    }
    assert.equal(instance.running, false);
    assert.equal(await readFile(path.join(temp, action, 'cancelled.txt'), 'utf8'), 'ASGI finally completed');
    if (action !== 'worker-disconnect') {
      await bounded(instance.setModule('library', false));
      await bounded(instance.setModule('paperwork', true));
      await bounded(instance.setModule('paperwork', false));
      assert.equal(instance.running, false);
    }
    console.log('PASS retained Range: ' + action);
  }
  console.log('PASS mutation outcome_unknown/reconcile, read/pre-send loss, actual worker Range cancellation/OFF/close/disconnect, other-module progress and ON/OFF/ON');
  for (const cause of ['off', 'close', 'eof']) {
    const name = 'concurrent-' + cause;
    const instance = service(name, python, [worker]);
    await instance.setModule('library', true);
    await instance.setModule('paperwork', true);
    await writeFile(path.join(temp, name, 'hold-cleanup'), 'hold');
    const response = await bounded(instance.stream('GET', '/paperwork/retained'));
    const reader = response.body.getReader();
    await bounded(reader.read());
    let consumerDone = false, stopDone = false;
    const consumer = reader.cancel().then(() => { consumerDone = true; });
    await bounded((async () => {
      for (;;) {
        try { await readFile(path.join(temp, name, 'cleanup-entered')); return; }
        catch { await new Promise(resolve => setTimeout(resolve, 10)); }
      }
    })());
    let stop;
    if (cause === 'eof') {
      stop = new Promise(resolve => instance.child.once('exit', resolve));
      instance.child.stdin.end();
    } else stop = cause === 'off' ? instance.setModule('paperwork', false) : instance.close();
    stop = stop.then(() => { stopDone = true; });
    try {
      if (cause !== 'eof') {
        const other = await bounded(instance.request('GET', '/library/api/health'));
        assert.equal(other.status, 200);
      }
      assert.equal(consumerDone, false, 'consumer waits for actual asynchronous cleanup');
      assert.equal(stopDone, false, 'OFF/close/EOF waits for the same cleanup');
    } finally {
      await writeFile(path.join(temp, name, 'release-cleanup'), 'release');
    }
    await bounded(Promise.all([consumer, stop]));
    assert.equal(await readFile(path.join(temp, name, 'cancelled.txt'), 'utf8'), 'ASGI finally completed');
    await instance.setModule('paperwork', false);
    await instance.setModule('library', false);
    await instance.setModule('paperwork', true);
    await instance.setModule('paperwork', false);
    assert.equal(instance.running, false);
    console.log('PASS consumer cancellation + ' + cause + ' share retained cleanup');
  }
  console.log('Synthetic receipts retained at ' + temp);
} finally {
  await Promise.all(instances.map(instance => instance.close()));
}
