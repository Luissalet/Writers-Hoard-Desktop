const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const dbMod = await import('/src/db/index.ts');
const net = await import('/src/services/deleteSafetyNet.ts');
const db = dbMod.db;

// A throwaway project with something in it, so the copy has content to carry.
const pid = 'proj_farewell_probe';
const now = Date.now();
await db.projects.put({
  id: pid, title: 'ZZ Despedida (borrar)', mode: 'novelist', type: 'standalone',
  color: '#7c3aed', description: '', status: 'in-progress',
  enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: now, updatedAt: now,
});
await db.writings.put({
  id: 'wrt_farewell', projectId: pid, title: 'El unico capitulo', status: 'draft',
  content: '<p>Texto irreemplazable.</p>', wordCount: 2, chapter: 1, tags: [],
  createdAt: now, updatedAt: now,
});
await sleep(700);

out.name = net.farewellFileName('ZZ Despedida (borrar)', new Date());
out.result = await net.archiveProjectBeforeDelete(pid);

await db.writings.delete('wrt_farewell');
await db.projects.delete(pid);
return JSON.stringify(out, null, 2);
