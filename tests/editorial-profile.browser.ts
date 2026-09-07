import { db } from '@/db';
import { EMPTY_EDITORIAL_PROFILE, EditorialProfileError, buildProjectEditorialContext, getEditorialProfile, saveEditorialProfile } from '@/services/editorialProfile';
import { buildCopilotSystemPrompt } from '@/services/aiRuntime/prompts';
import { buildJudgeDisclosure, runJudge } from '@/services/judge/runner';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import type { Project, Writing } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function testEditorialProfile(): Promise<string[]> {
  const id = `editorial-${crypto.randomUUID()}`;
  const project: Project = { id, title: 'Reporting', description: '', mode: 'reporter', type: 'idea', color: '#111', status: 'draft', enabledEngines: ['writings'], engineOrder: [], createdAt: 1, updatedAt: 1 };
  const writing: Writing = { id: `${id}-writing`, projectId: id, title: 'Article', content: '<p>The witness saw two buses.</p>', status: 'draft', wordCount: 6, tags: [], createdAt: 1, updatedAt: 1 };
  const before = useAiRuntimeStore.getState();
  try {
    await db.projects.bulkAdd([project, { ...project, id: `${id}-other` }]);
    await db.writings.add(writing);
    assert(await buildProjectEditorialContext(id) === '', 'Existing projects should start without attached profile');
    const input = { ...EMPTY_EDITORIAL_PROFILE, enabled: true, voice: 'Concrete and concise', rules: 'Preserve quotations', examples: '“I saw two buses,” said the witness.' };
    const races = await Promise.allSettled([saveEditorialProfile(id, input, 0), saveEditorialProfile(id, { ...input, voice: 'Different voice' }, 0)]);
    assert(races.filter(row => row.status === 'fulfilled').length === 1, 'Concurrent profiles must not overwrite one another');
    assert(races.some(row => row.status === 'rejected' && row.reason instanceof EditorialProfileError && row.reason.code === 'conflict'), 'Conflict should be recoverable');
    const profile = await getEditorialProfile(id);
    assert(profile.revision === 1 && profile.examples === input.examples, 'Profile should reopen with intact quotation');
    assert((await getEditorialProfile(`${id}-other`)).revision === 0, 'Profiles must remain project-scoped');
    const context = await buildProjectEditorialContext(id);
    const prompt = buildCopilotSystemPrompt({ projectId: id, projectTitle: project.title, enabledEngines: ['writings'], locale: 'es', policy: 'read-only', toolsAvailable: true, editorialContext: context });
    assert(prompt.includes(profile.voice) && prompt.includes('Never change verbatim quotations'), 'Copilot must receive the approved voice and quotation protection');
    useAiRuntimeStore.setState({ connectionsLoaded: true, defaults: { chat: { connectionId: id, modelId: 'fixture' } }, connections: [{ id, name: 'Fixture', kind: 'openai-compatible', baseUrl: 'https://example.com/v1', enabled: true, hasSecret: false, locality: 'remote', modelTypes: ['chat'], pinnedModels: [], status: 'online', createdAt: 1, updatedAt: 1 }] });
    const judgeInput = { projectId: id, writing, mode: 'judge' as const, scope: 'chapter' as const, sourceMode: 'continuity' as const, lensIds: [], context: { previousWritings: false, selectedWritingIds: [], codex: false, outline: false, timeline: false } };
    const disclosure = await buildJudgeDisclosure(judgeInput);
    assert(disclosure.summary.internalCharacters === context.length, 'Disclosure must count the exact additional profile payload');
    assert(disclosure.summary.evidence.some(row => row.id === 'editorial-profile' && row.characters === context.length), 'Disclosure must fingerprint the profile');
    await saveEditorialProfile(id, { ...profile, voice: 'Changed since disclosure' }, profile.revision);
    let stale = false;
    try { await runJudge({ ...judgeInput, allowRemote: true, expectedDisclosureFingerprint: disclosure.summary.disclosureFingerprint }); } catch (error) { stale = error instanceof Error && error.message === 'judge-disclosure-stale'; }
    assert(stale, 'A changed profile must invalidate old remote disclosure before contacting a model');
    const latest = await getEditorialProfile(id);
    await saveEditorialProfile(id, { ...latest, enabled: false }, latest.revision);
    assert(await buildProjectEditorialContext(id) === '', 'Disabling the profile must withhold all its fields');
    return ['editorial profile persistence, concurrent edit protection and project isolation', 'copilot voice and preserved quotations', 'judge profile payload disclosure and stale-consent guard'];
  } finally {
    useAiRuntimeStore.setState(before);
    await db.writings.delete(writing.id);
    await db.projects.bulkDelete([id, `${id}-other`]);
  }
}
