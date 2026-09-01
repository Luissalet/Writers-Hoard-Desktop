const dbMod = await import('/src/db/index.ts');
const db = dbMod.db;
const projects = await db.projects.toArray();
return JSON.stringify({
  projects: projects.map((p) => ({ title: p.title, id: p.id })),
  strays: projects.filter((p) => /^ZZ |probe/i.test(p.title)).map((p) => p.title),
}, null, 2);
