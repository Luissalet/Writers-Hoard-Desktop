const out = {};
const pid = 'proj_mthy3jeu_q7kvd1';

globalThis.__impTrail = [];
const zipMod = await import('/src/services/zipBackup.ts');
const dbMod = await import('/src/db/index.ts');
const db = dbMod.db;

// What the project holds before we touch it.
out.before = {
  writings: await db.writings.where('projectId').equals(pid).count(),
  beats: await db.outlineBeats.where('projectId').equals(pid).count(),
  seeds: await db.seeds.where('projectId').equals(pid).count(),
  payoffs: await db.payoffs.where('projectId').equals(pid).count(),
  codex: await db.codexEntries.where('projectId').equals(pid).count(),
  aiSettings: await db.aiProjectSettings.where('projectId').equals(pid).count(),
};

const { blob, fileName } = await zipMod.createProjectZipArchive(pid);
out.archive = { name: fileName, bytes: blob.size };
const file = new File([blob], fileName, { type: 'application/zip' });

// Restore it over itself. Before the fix this never returned.
const started = Date.now();
const outcome = await Promise.race([
  zipMod
    .importProjectZip(file, { replaceProjectIds: [pid] })
    .then(() => 'returned')
    .catch((e) => {
      out.error = String(e && e.name) + ': ' + String(e && e.message).slice(0, 300);
      out.failures = JSON.stringify((e && e.failures) || null).slice(0, 500);
      return 'threw';
    }),
  new Promise((r) => setTimeout(() => r('HUNG'), 20000)),
]);
out.outcome = outcome;
out.elapsedMs = Date.now() - started;
out.trail = (globalThis.__impTrail || []).join(' > ');

out.after = {
  writings: await db.writings.where('projectId').equals(pid).count(),
  beats: await db.outlineBeats.where('projectId').equals(pid).count(),
  seeds: await db.seeds.where('projectId').equals(pid).count(),
  payoffs: await db.payoffs.where('projectId').equals(pid).count(),
  codex: await db.codexEntries.where('projectId').equals(pid).count(),
  aiSettings: await db.aiProjectSettings.where('projectId').equals(pid).count(),
};
return JSON.stringify(out, null, 2);
