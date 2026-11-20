// Evidence packs through the AI bridge: a research station's claims filed as
// cited sources (wh_import_evidence), a claim cited in a chapter without
// rewriting the text, a Coase dossier pulled through the Hub, and undo.
//   npm run test:evidencepack
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

const PACK = {
  ref: 'hoard://test/research/printers',
  title: 'Tres impresoras multicolor',
  sources: [
    { id: 'C2', title: 'Creality — preguntas frecuentes de K2 Plus y CFS', url: 'https://store.creality.com/es/blogs/tutorial/creality-k2-plus-cfs-faqs', publisher: 'Creality' },
    { id: 'P1', title: 'Prusa — ficha de CORE One+', url: 'https://www.prusa3d.com/core-one/' },
    { id: 'X9', title: 'A source no claim uses' },
  ],
  claims: [
    { text: 'Llegar a 16 colores en la K2 Plus exige cuatro unidades CFS.', source_id: 'C2', quote: 'Un CFS admite cuatro colores. La capacidad de 16 requiere cuatro unidades en total.', locator: 'FAQ 3' },
    { text: 'La CORE One+ declara 250 × 220 × 270 mm.', source_id: 'P1', quote: 'Volumen declarado de 250 × 220 × 270 mm.' },
    { text: 'A claim without a quote is skipped.', source_id: 'P1', quote: '' },
  ],
};

const COASE_REPORT = {
  id: 'report_abc', case: { name: 'Taller' }, question: '¿Qué impresora comprar?',
  sources: [{ id: 'src_1', title: 'Bambu Lab — lanzamiento de P2S', url: 'https://blog.bambulab.com/p2s', published: '2026-08-01' }],
  findings: [{ id: 'finding_1', section: 'product', kind: 'documented', claim: 'La P2S trabaja en un cubo de 256 mm.',
    source_ids: ['src_1'], quotes: [{ source_id: 'src_1', text: 'build volume of 256 × 256 × 256 mm' }] }],
};

export async function testEvidencePackBridge(): Promise<string[]> {
  const { db } = await import('@/db');
  const { getBridgeTool } = await import('@/services/aiBridge/manifest');
  const { runBridgeTool } = await import('@/services/aiBridge/dispatch');
  const { setFamilyTransport } = await import('@/services/familyBridge/client');
  const out: string[] = [];

  const tool = getBridgeTool('wh_import_evidence');
  assert(tool && tool.writes, 'wh_import_evidence is a write tool of the catalogue');
  assert(tool.description.split('\n')[0].length <= 110, 'first line within 110 characters');
  out.push('wh_import_evidence is in the catalogue');

  const projectId = `evp-${crypto.randomUUID()}`, writingId = crypto.randomUUID(), now = Date.now();
  const engines = ['writings'];
  await db.projects.add({ id: projectId, title: 'Informe', mode: 'custom', type: 'standalone', color: '#888', description: '', status: 'draft', enabledEngines: engines, engineOrder: engines, createdAt: now, updatedAt: now });
  await db.writings.add({ id: writingId, projectId, title: 'Informe', status: 'draft', content: '<p>Para dieciséis colores hay que pensar en el espacio.</p>', wordCount: 8, chapter: 1, tags: [], createdAt: now, updatedAt: now });

  type Result = Record<string, unknown> & { __audit?: Record<string, unknown> };
  const call = async (name: string, args: Record<string, unknown>): Promise<Result> => {
    const reply = await runBridgeTool(name, { projectId, ...args });
    assert(reply.ok, `${name}: ${JSON.stringify(reply)}`);
    return reply.result as Result;
  };
  const undo = async (name: string, result: Result) => {
    const reply = await runBridgeTool('__undo', { entry: { ...result.__audit, tool: name } });
    assert(reply.ok, `undo ${name}: ${JSON.stringify(reply)}`);
  };

  try {
    const filed = await call('wh_import_evidence', { pack: PACK });
    type Claim = { claim: string; quote: string; sourceId: string; evidenceId: string; alreadyFiled: boolean };
    const claims = filed.claims as Claim[];
    assert(filed.sourcesCreated === 2 && claims.length === 2, `two sources and two claims filed: ${JSON.stringify(filed)}`);
    const sixteen = claims.find(c => c.claim.includes('16 colores'))!;
    const citation = await db.citations.get(sixteen.sourceId);
    assert(citation && citation.projectId === projectId && citation.url?.includes('creality') && citation.publisher === 'Creality', 'the source keeps title, address and publisher');
    const evidence = citation.researchEvidence?.find(e => e.id === sixteen.evidenceId);
    assert(evidence && evidence.quote === PACK.claims[0].quote && evidence.statement === PACK.claims[0].text && evidence.locator === 'FAQ 3' && evidence.status === 'pending',
      'the claim is an evidence row of its source with the quote verbatim');
    out.push('each claim keeps its source and its verbatim quote');

    const again = await call('wh_import_evidence', { pack: PACK });
    assert(again.sourcesCreated === 0 && (again.claims as Claim[]).every(c => c.alreadyFiled) && !again.__audit, 'filing the same pack again adds nothing');
    assert((await db.citations.where('projectId').equals(projectId).count()) === 2, 'still two sources');
    out.push('re-filing the same pack is recognised');

    const before = (await db.writings.get(writingId))!.content;
    const end = 1 + 'Para dieciséis colores hay que pensar en el espacio.'.length;
    await call('wh_edit_writing_editorial', { id: writingId, operation: { kind: 'insertCitation', sourceId: sixteen.sourceId, evidenceId: sixteen.evidenceId, range: { from: end, to: end } } });
    const after = (await db.writings.get(writingId))!.content;
    assert(after.includes('data-wh-citation') && after.includes(sixteen.evidenceId), `the citation is in the chapter: ${after}`);
    assert(after.replace(/<span[^>]*data-wh-citation[^>]*>.*?<\/span>/g, '') .includes('Para dieciséis colores hay que pensar en el espacio.') && before.includes('dieciséis'),
      'the sentence around the citation is unchanged');
    out.push('a filed claim is cited in the chapter without rewriting it');

    // The same pack comes back with a new claim B on a source already filed (C2):
    // B joins that source, A keeps its row, and undo takes back B alone.
    const claimB = { text: 'Cada CFS guarda cuatro bobinas secas.', source_id: 'C2', quote: 'El CFS mantiene secas las cuatro bobinas que aloja.', locator: 'FAQ 5' };
    // It also brings a new source Z, so one call both creates and adds.
    const sourceZ = { id: 'Z1', title: 'Bambu Lab — ficha de H2D', url: 'https://bambulab.com/h2d' };
    const claimZ = { text: 'La H2D tiene dos boquillas.', source_id: 'Z1', quote: 'Sistema de doble boquilla.' };
    const grown = await call('wh_import_evidence', { pack: { ...PACK, sources: [...PACK.sources, sourceZ], claims: [...PACK.claims, claimB, claimZ] } });
    const grownClaims = grown.claims as Claim[];
    const filedB = grownClaims.find(c => c.claim === claimB.text);
    assert(grown.sourcesCreated === 1 && filedB && !filedB.alreadyFiled && filedB.sourceId === sixteen.sourceId && grown.__audit,
      `a new claim on a filed source is added to it: ${JSON.stringify(grown)}`);
    assert(grownClaims.find(c => c.claim === sixteen.claim)?.evidenceId === sixteen.evidenceId, 'claim A keeps its evidence row');
    const widened = (await db.citations.get(sixteen.sourceId))!.researchEvidence ?? [];
    assert(widened.length === 2 && widened.some(e => e.id === filedB.evidenceId && e.quote === claimB.quote && e.statement === claimB.text),
      `the source now holds A and B with B's quote verbatim: ${JSON.stringify(widened)}`);
    assert((await db.citations.where('projectId').equals(projectId).count()) === 3, 'the new source Z is filed');
    out.push('a re-filed pack with a new claim adds it to its source');

    await undo('wh_import_evidence', grown);
    const narrowed = (await db.citations.get(sixteen.sourceId))!.researchEvidence ?? [];
    assert(narrowed.length === 1 && narrowed[0].id === sixteen.evidenceId, `undo removes B and keeps A: ${JSON.stringify(narrowed)}`);
    assert((await db.writings.get(writingId))!.content === after, 'the paragraph citing A is untouched by the undo');
    assert((await db.citations.where('projectId').equals(projectId).count()) === 2, 'undo removes the new source Z and no other');
    out.push('undo of the re-filing takes back the new claim only');

    const asked: Array<{ app: string; tool: string; args: Record<string, unknown> }> = [];
    setFamilyTransport(async request => {
      asked.push(request);
      return { ok: true, app: request.app, tool: request.tool, result: COASE_REPORT } as never;
    });
    const fromCoase = await call('wh_import_evidence', { coaseReportId: 'report_abc' });
    assert(asked.length === 1 && asked[0].app === 'coase' && asked[0].tool === 'coase_report' && asked[0].args.report_id === 'report_abc', 'the report is asked of Coase through the Hub');
    const [coaseClaim] = fromCoase.claims as Claim[];
    const coaseSource = await db.citations.get(coaseClaim.sourceId);
    assert(fromCoase.ref === 'hoard://coase/report/report_abc' && coaseClaim.quote === 'build volume of 256 × 256 × 256 mm' && coaseSource?.publishedAt === '2026-08-01',
      `a Coase finding becomes a claim with its quote: ${JSON.stringify(fromCoase)}`);
    out.push('a Coase dossier report is pulled through the Hub and filed');

    setFamilyTransport(async () => ({ ok: false, code: 'app_unavailable', error: 'Coase is not running' }) as never);
    const down = await runBridgeTool('wh_import_evidence', { projectId, coaseReportId: 'report_abc' });
    assert(!down.ok && JSON.stringify(down).includes('Start Coase'), 'a stopped Coase is explained');
    const empty = await runBridgeTool('wh_import_evidence', { projectId, pack: { ref: 'x', sources: [{ id: 'a', title: 'A' }], claims: [] } });
    assert(!empty.ok, 'a pack with no quoted claim is refused');
    out.push('a stopped Coase and an empty pack are refused with a reason');

    await undo('wh_import_evidence', fromCoase);
    assert(!(await db.citations.get(coaseClaim.sourceId)), 'undo removes the source the import created');
    assert((await db.citations.where('projectId').equals(projectId).count()) === 2, 'the earlier sources stay');
    out.push('undo removes what the import created and nothing else');

    // A Nightingale table: asked through the Hub, filed with one claim per row, inserted cited without retyping a figure.
    const handoff = (version: number, rows: Array<[string, number]>) => ({
      kind: 'data-chart', title: 'Devoluciones por puesto', columns: ['station', 'returns'], rows,
      csv: ['station,returns', ...rows.map(([s, n]) => `${s},${n}`)].join('\n') + '\n',
      chart: { id: 4, type: 'bar', x: 'station', y: 'returns', agg: 'sum' },
      provenance: { app: 'nightingale', ref: 'hoard://nightingale/chart/4', dataset: 'returns', version, version_created_at: '2026-11-20 02:20:00',
        query: 'SELECT "station" AS x, SUM("returns") AS y FROM "returns" GROUP BY "station"', fingerprint: `${version}abcdef0123456789` },
    });
    let served = handoff(0, [['writer', 5], ['cicero', 1], ['hypatia', 1]]);
    const askedNg: Array<{ app: string; tool: string; args: Record<string, unknown> }> = [];
    setFamilyTransport(async request => { askedNg.push(request); return { ok: true, app: request.app, tool: request.tool, result: served } as never; });
    const ng = await call('wh_import_evidence', { nightingale: { chart_id: 4 } });
    assert(askedNg.length === 1 && askedNg[0].app === 'nightingale' && askedNg[0].tool === 'data_handoff' && askedNg[0].args.chart_id === 4, 'the table is asked of Nightingale through the Hub');
    const ngTable = ng.table as { sourceId: string; rows: number; version: number };
    const ngSource = await db.citations.get(ngTable.sourceId);
    assert(ngTable.rows === 3 && ngTable.version === 0 && ngSource?.dataTable?.ref === 'hoard://nightingale/chart/4' && ngSource.publisher === "Nightingale's Hoard",
      `the source keeps the table and where it comes from: ${JSON.stringify(ng)}`);
    const rowClaims = ng.claims as Claim[];
    assert(rowClaims.length === 3 && rowClaims[0].claim === 'station: writer · returns: 5' && rowClaims[0].quote === 'writer,5', `one claim per row, quoted as Nightingale wrote it: ${JSON.stringify(rowClaims)}`);
    out.push('a Nightingale table is filed as a source with one quoted claim per row');

    const plain = (await db.writings.get(writingId))!.content;
    const inserted = await call('wh_edit_writing_editorial', { id: writingId, operation: { kind: 'insertDataTable', sourceId: ngTable.sourceId } });
    const withTable = (await db.writings.get(writingId))!.content;
    assert(withTable.includes('<table') && withTable.includes('<th') && withTable.includes('hypatia') && /<td[^>]*>(<p>)?5(<\/p>)?<\/td>/.test(withTable),
      `the table is in the chapter with Nightingale's figures: ${withTable}`);
    assert(withTable.includes('data-wh-citation') && withTable.includes(ngTable.sourceId), 'the table caption cites its source');
    assert(withTable.includes('Para dieciséis colores hay que pensar en el espacio.'), 'the text before it is unchanged');
    await undo('wh_edit_writing_editorial', inserted);
    assert((await db.writings.get(writingId))!.content === plain, 'undo takes the table out');
    out.push('insertDataTable puts the table in the chapter, cited, and undo takes it out');

    const same = await call('wh_import_evidence', { nightingale: { chart_id: 4 } });
    assert(same.sourcesCreated === 0 && (same.claims as Claim[]).every(c => c.alreadyFiled), 'the same table filed again is recognised');
    served = handoff(1, [['writer', 4], ['cicero', 2], ['hypatia', 1]]);
    const moved = await call('wh_import_evidence', { nightingale: { chart_id: 4 } });
    assert(moved.sourcesCreated === 1 && (moved.table as { sourceId: string }).sourceId !== ngTable.sourceId, 'new data in Nightingale is a new source, the old one stays');
    out.push('a new version of the data is a new source; the same one is recognised');

    const noTable = await runBridgeTool('wh_edit_writing_editorial', { projectId, id: writingId, operation: { kind: 'insertDataTable', sourceId: sixteen.sourceId } });
    assert(!noTable.ok && JSON.stringify(noTable).includes('tabla de datos'), 'a source without a table is refused with a reason');
    setFamilyTransport(async () => ({ ok: false, code: 'app_unavailable', error: 'Nightingale is not running' }) as never);
    const ngDown = await runBridgeTool('wh_import_evidence', { projectId, nightingale: { chart_id: 4 } });
    assert(!ngDown.ok && JSON.stringify(ngDown).includes("Start Nightingale's Hoard"), 'a stopped Nightingale is explained');
    out.push('a source without a table and a stopped Nightingale are refused with a reason');
  } finally {
    setFamilyTransport(null);
    await db.citations.where('projectId').equals(projectId).delete();
    await db.writings.delete(writingId);
    await db.projects.delete(projectId);
  }
  return out;
}
