import { db } from '@/db';
import { BRIDGE_TOOLS, getBridgeTool } from '@/services/aiBridge/manifest';
import { SCOPE_KEY } from '@/services/aiBridge/schema';
import { TOOL_HANDLERS } from '@/services/aiBridge/tools';
import { BridgeError } from '@/services/aiBridge/tools/shared';
import { applyProjectScope, decidePermission } from '@/services/aiRuntime/toolPolicy';
import { selectToolsForTurn } from '@/services/aiRuntime/toolSelection';
import type { EditorialProfile } from '@/types/editorial';
import type { ResearchEvidence } from '@/types/projectTools';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

type EditorialResult = {
  projectId: string; profile: EditorialProfile; context: string; workflows: unknown[];
  research: { total: number; pending: number; reviewed: number; disputed: number };
};

export async function testEditorialBridge(): Promise<string[]> {
  const projectId = 'editorial-bridge-fixture';
  const name = 'wh_get_editorial_context';
  const spec = getBridgeTool(name);
  assert(spec && TOOL_HANDLERS[name], 'Editorial context must be exposed through the shared manifest and handler');
  const profile: EditorialProfile = {
    enabled: true, voice: 'Precise reporting, concrete language.', audience: 'Local readers',
    rules: 'Keep quotations intact.', context: 'Transport investigation',
    examples: 'The witness said: “I saw two buses.”', revision: 4,
  };
  const read = (args: Record<string, unknown>) => TOOL_HANDLERS[name](args) as Promise<EditorialResult>;
  try {
    await db.projects.put({
      id: projectId, title: 'Investigation', description: '', color: '#aaa', type: 'idea',
      mode: 'custom', status: 'draft', enabledEngines: [], engineOrder: [],
      createdAt: 1, updatedAt: 1, editorialProfile: profile,
    });
    for (const id of [projectId, 'editorial-bridge-other']) {
      await db.citations.put({
        id, projectId: id, title: 'Private source', authors: [], accessedAt: '2026-09-07',
        writingIds: [], tags: [], createdAt: 1, updatedAt: 1,
        researchEvidence: [{
          id: `${id}-evidence`, statement: 'There were two buses.', kind: 'fact', quote: 'Private interview transcript',
          locator: 'Line 1', status: 'pending', notes: '', createdAt: 1, updatedAt: 1,
        }],
      });
    }
    const before = JSON.stringify(await db.projects.get(projectId));
    const external = await read({ projectId });
    assert(external.profile.voice === profile.voice && external.context.includes(profile.voice), 'External clients must receive the saved project voice');
    assert(external.profile.examples === profile.examples, 'Reading context must preserve quotations verbatim');
    assert(external.workflows.length === 0, 'Legacy projects must return an empty workflow list');
    assert(external.research.total === 1 && external.research.pending === 1, 'Research counts must include only the requested project');
    assert(!JSON.stringify(external).includes('Private interview transcript'), 'Orientation must not retrieve arbitrary source excerpts');
    const pinned = applyProjectScope(spec, {}, { origin: 'copilot', projectId });
    assert(pinned.ok, 'Copilot should resolve editorial context to its own project');
    assert(JSON.stringify(await read(pinned.args)) === JSON.stringify(external), 'Copilot and MCP must see identical editorial context');
    assert(JSON.stringify(await db.projects.get(projectId)) === before, 'Reading editorial context must not modify the project');
    assert(decidePermission(spec, { origin: 'copilot', actionPolicy: 'read-only' }, false).allowed, 'Read-only users must have editorial context');
    const selected = selectToolsForTurn({ tools: BRIDGE_TOOLS, message: 'Revisa este artículo', readOnly: true, max: 4 });
    assert(selected.some(tool => tool.name === name), 'The copilot must retain editorial context even under a tight tool budget');
    const deletion = selectToolsForTurn({ tools: BRIDGE_TOOLS, message: 'borra el capítulo 3', openEngine: 'writings', max: 4 });
    assert(deletion.some(tool => tool.name === 'wh_delete') && deletion.length <= 4, 'Optional editorial context must not displace the requested deletion under a tight budget');
    const continued = selectToolsForTurn({ tools: BRIDGE_TOOLS, message: 'sigue', usedTools: ['wh_get_writing'], max: 4 });
    assert(continued.some(tool => tool.name === 'wh_get_writing'), 'Editorial context must not displace a tool needed for conversation continuity');
    const rejected = applyProjectScope(spec, { projectId: 'another-project' }, { origin: 'copilot', projectId });
    assert(!rejected.ok && rejected.code === 'scope', 'Copilot context must not cross project boundaries');
    try {
      await read({ projectId, [SCOPE_KEY]: 'another-project' });
      throw new Error('The handler accepted another project scope');
    } catch (error) {
      assert(error instanceof BridgeError && error.code === 'scope', 'The handler must enforce its scope independently');
    }
    await db.projects.update(projectId, { editorialProfile: { ...profile, enabled: false } });
    const disabled = await read({ projectId });
    assert(!disabled.profile.enabled && disabled.context === '', 'A disabled profile must not produce active editorial instructions');
    const researchName = 'wh_get_research_evidence';
    const researchSpec = getBridgeTool(researchName);
    assert(researchSpec && TOOL_HANDLERS[researchName] && !researchSpec.writes, 'Research evidence needs a shared read-only tool');
    const readResearch = (args: Record<string, unknown>) => TOOL_HANDLERS[researchName](args) as Promise<{
      evidence: Array<ResearchEvidence & { citation: { id: string; title: string } }>;
      total: number; nextOffset: number | null;
    }>;
    const items: ResearchEvidence[] = Array.from({ length: 24 }, (_, index) => ({
      id: `research-item-${index}`, statement: `Assertion ${index}`, kind: 'attribution',
      quote: 'The witness said: “I saw two buses.”', locator: `Line ${index + 1}`, status: 'pending',
      notes: 'Recorded testimony; not independently verified.', createdAt: index + 1, updatedAt: index + 1,
    }));
    await db.citations.update(projectId, { researchEvidence: items });
    const sourceBefore = JSON.stringify(await db.citations.get(projectId));
    const exact = await readResearch({ projectId, citationId: projectId, evidenceId: 'research-item-0' });
    assert(exact.evidence.length === 1 && exact.evidence[0].quote === items[0].quote && exact.evidence[0].status === 'pending', 'Exact evidence lookup must preserve literal quotation and human review status');
    assert(exact.evidence[0].citation.id === projectId && exact.evidence[0].citation.title === 'Private source', 'Evidence must include its actual citation provenance');
    const firstPage = await readResearch({ projectId, limit: 999 });
    assert(firstPage.evidence.length === 20 && firstPage.total === 24 && firstPage.nextOffset === 20, 'Evidence retrieval must cap responses and provide pagination');
    const secondPage = await readResearch({ projectId, offset: firstPage.nextOffset, limit: 20 });
    assert(secondPage.evidence.length === 4 && secondPage.nextOffset === null, 'Pagination must expose the remaining assertions');
    assert(!firstPage.evidence.some(item => secondPage.evidence.some(other => other.id === item.id)), 'Evidence pagination must not repeat items');
    assert((await readResearch({ projectId, citationId: 'editorial-bridge-other' })).evidence.length === 0, 'Citation filters must not disclose another project');
    assert((await readResearch({ projectId, evidenceId: 'editorial-bridge-other-evidence' })).evidence.length === 0, 'Assertion filters must not disclose another project');
    const researchPinned = applyProjectScope(researchSpec, { evidenceId: 'research-item-0' }, { origin: 'copilot', projectId });
    assert(researchPinned.ok, 'Copilot must pin evidence retrieval to its own project');
    assert((await readResearch(researchPinned.args)).evidence[0].quote === items[0].quote, 'MCP and copilot must retrieve the same source fragment');
    assert(JSON.stringify(await db.citations.get(projectId)) === sourceBefore, 'Evidence retrieval must not alter source records');
    assert(selectToolsForTurn({ tools: BRIDGE_TOOLS, message: 'Comprueba las fuentes de este artículo', readOnly: true, max: 5 }).some(tool => tool.name === researchName), 'Spanish research requests must expose the evidence tool before engine catalogs');
    await db.projects.delete(projectId);
    try {
      await read({ projectId });
      throw new Error('Missing project was accepted');
    } catch (error) {
      assert(error instanceof BridgeError && error.code === 'not-found', 'Missing projects must produce a model-readable error');
    }
    return [
      'Editorial context is identical in MCP and copilot, preserves quotations and performs no writes',
      'Editorial context remains available in read-only turns and enforces project boundaries',
      'Disabled editorial profiles produce no active instructions; missing projects are rejected',
      'Research counts stay project-scoped and do not disclose private source excerpts',
      'Evidence retrieval preserves literal excerpts, human review status and citation provenance across transports',
      'Evidence filters remain project-scoped, cap responses and paginate without mutating source records',
    ];
  } finally {
    await db.projects.delete(projectId);
    await db.citations.bulkDelete([projectId, 'editorial-bridge-other']);
  }
}
