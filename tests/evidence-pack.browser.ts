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
  } finally {
    setFamilyTransport(null);
    await db.citations.where('projectId').equals(projectId).delete();
    await db.writings.delete(writingId);
    await db.projects.delete(projectId);
  }
  return out;
}
