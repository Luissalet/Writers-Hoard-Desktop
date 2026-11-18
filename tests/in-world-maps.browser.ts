// In-world cartographer plates through the AI bridge: catalogue registration,
// save/list/export, insertion into a chapter and wh_undo for every write.
//   npm run test:inworldmaps
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

const IN_WORLD_MAP_TOOL_NAMES = ['wh_list_in_world_maps', 'wh_list_cartographers', 'wh_save_in_world_map', 'wh_export_in_world_map', 'wh_insert_in_world_map', 'wh_remove_in_world_map'];

export async function testInWorldMapsBridge(): Promise<string[]> {
  const { db } = await import('@/db');
  const { normalizeParams } = await import('@/engines/worldgen/core/types');
  const { generateWorld } = await import('@/engines/worldgen/core/pipeline');
  const { paramsKey } = await import('@/engines/worldgen/useWorldGeneration');
  const { saveSnapshot } = await import('@/engines/worldgen/snapshots');
  const { getBridgeTool } = await import('@/services/aiBridge/manifest');
  const { runBridgeTool } = await import('@/services/aiBridge/dispatch');
  const out: string[] = [];

  for (const name of IN_WORLD_MAP_TOOL_NAMES) {
    const tool = getBridgeTool(name);
    assert(tool, `${name} is in the bridge catalogue`);
    assert(tool.description.split('\n')[0].length <= 110, `${name}: first line within 110 characters`);
  }
  out.push('six in-world map tools are in the catalogue with short first lines');

  const projectId = `iwm-${crypto.randomUUID()}`, worldId = crypto.randomUUID(), writingId = crypto.randomUUID(), now = Date.now();
  const engines = ['worldgen', 'codex', 'writings'];
  await db.projects.add({ id: projectId, title: 'Plates', mode: 'custom', type: 'standalone', color: '#888', description: '', status: 'draft', enabledEngines: engines, engineOrder: engines, createdAt: now, updatedAt: now });
  const params = normalizeParams({ seed: 'in-world-maps', width: 512 });
  await db.generatedWorlds.add({ id: worldId, projectId, title: 'W', params, createdAt: now, updatedAt: now });
  await saveSnapshot(worldId, paramsKey(params), generateWorld(params));
  await db.writings.add({ id: writingId, projectId, title: 'Chapter', status: 'draft', content: '<p>The road north.</p>', wordCount: 3, chapter: 1, tags: [], createdAt: now, updatedAt: now });

  type Result = Record<string, unknown> & { pending?: boolean; __audit?: Record<string, unknown> };
  const call = async (tool: string, args: Record<string, unknown> = {}): Promise<Result> => {
    for (let i = 0; i < 120; i++) {
      const reply = await runBridgeTool(tool, { projectId, worldId, ...args });
      assert(reply.ok, `${tool}: ${JSON.stringify(reply)}`);
      const result = reply.result as Result;
      if (!result.pending) return result;
      await new Promise(ok => setTimeout(ok, 1000));
    }
    throw Error(`${tool} stayed pending`);
  };
  const undo = async (tool: string, result: Result) => {
    const reply = await runBridgeTool('__undo', { entry: { ...result.__audit, tool } });
    assert(reply.ok, `undo ${tool}: ${JSON.stringify(reply)}`);
  };
  const maps = async () => ((await call('wh_list_in_world_maps')).maps as { id: string; title: string }[]);

  try {
    const origins = (await call('wh_list_cartographers')).origins as { kind: 'culture' | 'place'; id: string; name: string }[];
    assert(origins.length > 0, 'The world offers cartographers');
    const saved = await call('wh_save_in_world_map', { title: 'Northern survey', origin: { kind: origins[0].kind, id: origins[0].id }, date: { year: 12 } });
    const mapId = saved.mapId as string;
    assert(mapId && (await maps()).length === 1, 'A saved plate is listed');
    out.push(`a plate from ${origins[0].name} is saved and listed`);

    const svg = await call('wh_export_in_world_map', { mapId, format: 'svg', locale: 'es' });
    assert(String(svg.mime).startsWith('image/svg+xml') && (svg.bytes as number) > 0 && typeof svg.base64 === 'string',
      `SVG export: ${JSON.stringify({ mime: svg.mime, bytes: svg.bytes, filename: svg.filename })}`);
    assert(Array.isArray(svg.places), 'The export reports the names the cartographer knows');
    out.push(`the plate exports as SVG (${svg.bytes} bytes, ${(svg.places as unknown[]).length} names)`);

    const renamed = await call('wh_save_in_world_map', { mapId, title: 'Survey of the north' });
    assert((await maps())[0].title === 'Survey of the north', 'Rename saved');
    await undo('wh_save_in_world_map', renamed);
    assert((await maps())[0].title === 'Northern survey', 'Undo restores the previous plate');
    out.push('undo of a save restores the previous plate');

    const inserted = await call('wh_insert_in_world_map', { mapId, writingId });
    let content = (await db.writings.get(writingId))!.content ?? '';
    assert(inserted.inserted === true && content.startsWith('<img') && content.includes('The road north.'), 'The plate opens the chapter');
    await undo('wh_insert_in_world_map', inserted);
    content = (await db.writings.get(writingId))!.content ?? '';
    assert(!content.includes('<img') && content.includes('The road north.'), 'Undo removes only the inserted plate');
    out.push('a plate inserted at the start of a chapter is removed by undo and the prose stays');

    const removed = await call('wh_remove_in_world_map', { mapId });
    assert((await maps()).length === 0, 'Removed');
    await undo('wh_remove_in_world_map', removed);
    assert((await maps()).length === 1, 'Undo brings the removed plate back');
    out.push('undo of a removal brings the plate back');
  } finally {
    const { deleteProject } = await import('@/db/operations');
    await deleteProject(projectId);
  }
  return out;
}
