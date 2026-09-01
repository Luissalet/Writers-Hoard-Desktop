const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const pid = 'proj_mthy3jeu_q7kvd1';
const dbMod = await import('/src/db/index.ts');
const ops = await import('/src/engines/writings/operations.ts');
const db = dbMod.db;

const row = (await db.writings.where('projectId').equals(pid).toArray())
  .filter((w) => (w.chapter ?? 0) > 0)
  .sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0))[0];
out.chapter = row.title;

// Open it in the editor and type, so the editor holds unsaved text.
location.hash = `#/project/${pid}/writings?writing=${encodeURIComponent(row.id)}`;
await sleep(3200);
const prose = document.querySelector('.ProseMirror');
if (prose) { prose.focus(); document.execCommand('insertText', false, ' TEXTO_DEL_ESCRITOR'); }
await sleep(600);

// The copilot's real path: the bridge dispatcher, which announces its write.
const bridge = await import('/src/services/aiBridge/dispatch.ts');
out.bridge = await bridge.runBridgeTool('wh_update_writing', {
  id: row.id,
  content: 'REESCRITO POR EL COPILOTO',
});
await sleep(6000);

const screen = ((document.querySelector('main') || document.body).innerText || '')
  .replace(/\s*\n\s*/g, ' | ');
out.bannerShown = /cambió en otro sitio/i.test(screen);
const i = screen.search(/cambió en otro sitio/i);
out.banner = i >= 0 ? screen.slice(Math.max(0, i - 60), i + 420) : '(no banner)';

// Neither text may be gone.
await sleep(2500);
const now = await db.writings.get(row.id);
out.rowHoldsCopilotText = (now?.content || '').includes('REESCRITO POR EL COPILOTO');
out.editorStillHasMine = (document.querySelector('.ProseMirror')?.innerText || '').includes('TEXTO_DEL_ESCRITOR');
const snaps = await db.writingSnapshots.where('writingId').equals(row.id).toArray();
out.myTextInHistory = snaps.some((v) => (v.content || '').includes('TEXTO_DEL_ESCRITOR'));
out.saveIndicator = screen.slice(0, 200);
return JSON.stringify(out, null, 2);
