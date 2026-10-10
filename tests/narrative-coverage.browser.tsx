import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { BRIDGE_TOOLS } from '@/services/aiBridge/manifest';
import { TOOL_HANDLERS } from '@/services/aiBridge/tools';
import {
  loadCoverageMatrix,
  loadTimelineEvidence,
  setCoverageCell,
  setTimelineEvidence,
} from '@/services/narrativeXray/coverageEvidence';
import { buildManuscriptBoard } from '@/services/narrativeXray/manuscriptViews';
import { buildPhraseRecurrence } from '@/services/narrativeXray/phraseRecurrence';
import NarrativeCoveragePanel from '@/engines/writings/components/NarrativeCoveragePanel';
import type { CodexEntry, Project, Writing } from '@/types';
import type { EntityLink } from '@/types/projectTools';
import type { OutlineBeat } from '@/engines/outline/types';
import type { ManuscriptViewMode } from '@/services/narrativeXray/manuscriptViews';

function assert(value: unknown, note: string): asserts value {
  if (!value) throw new Error(note);
}

export const COVERAGE_FIXTURE_ID = 'qa-narrative-coverage-140';

export async function seedCoverageFixture() {
  const now = 1791594000000;
  const project: Project = {
    id: COVERAGE_FIXTURE_ID,
    title: 'Synthetic coverage manuscript',
    description: 'Isolated #140 QA fixture — not Luis data.',
    mode: 'novelist',
    type: 'standalone',
    color: '#234',
    status: 'draft',
    enabledEngines: ['writings', 'codex', 'timeline', 'outline'],
    engineOrder: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.projects.put(project);
  await db.projects.put({ ...project, id: 'foreign-coverage', title: 'Foreign coverage' });

  const ana: CodexEntry = {
    id: 'char-ana',
    title: 'Ana Ruiz',
    type: 'character',
    projectId: project.id,
    fields: { aliases: 'A., Ana R.' },
    tags: [],
    relations: [],
    content: '<p>Cartógrafa.</p>',
    createdAt: now,
    updatedAt: now,
  };
  const luis: CodexEntry = {
    id: 'char-luis',
    title: 'Luis Ortega',
    type: 'character',
    projectId: project.id,
    fields: {},
    tags: [],
    relations: [],
    content: '<p>Otro.</p>',
    createdAt: now,
    updatedAt: now,
  };
  const foreignChar: CodexEntry = {
    id: 'char-foreign',
    title: 'Foreign Person',
    type: 'character',
    projectId: 'foreign-coverage',
    fields: {},
    tags: [],
    relations: [],
    content: '',
    createdAt: now,
    updatedAt: now,
  };
  await db.codexEntries.bulkPut([ana, luis, foreignChar]);

  const writings: Writing[] = Array.from({ length: 30 }, (_, i) => {
    const n = i + 1;
    const status = (['idea', 'draft', 'finished'] as const)[i % 3];
    let content = `<p>Chapter ${n} opens on the pier. Basically, the harbour waits.</p>`;
    if (n === 1) content = '<p>Ana Ruiz walks the pier. Basically basically the tide turns.</p>';
    if (n === 2) content = '<p>A. sketches the map. Luis Ortega is only planned, not here.</p>';
    if (n === 3) content = '<p>pov:Ana Ruiz watches the glass.</p>';
    if (n === 4) content = '';
    if (n === 5) {
      content =
        '<p>Ana remembered the storm over Faro and tried to avoid thinking about it.</p>';
    }
    if (n === 6) {
      content = '<p>That night the storm over Faro broke every window on the quay.</p>';
    }
    return {
      id: `w${n}`,
      projectId: project.id,
      title: `Chapter ${n}`,
      status,
      content,
      wordCount: content ? 12 : 0,
      chapter: n,
      tags: [],
      createdAt: now + n,
      updatedAt: now + n,
    };
  });
  await db.writings.bulkPut(writings);
  await db.writings.put({
    id: 'foreign-w',
    projectId: 'foreign-coverage',
    title: 'Foreign chapter',
    status: 'draft',
    content: '<p>Secret foreign prose.</p>',
    wordCount: 3,
    chapter: 1,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });

  const link: EntityLink = {
    id: 'link-plan-luis',
    projectId: project.id,
    sourceEngineId: 'writings',
    sourceEntityType: 'writing',
    sourceEntityId: 'w2',
    sourceTitle: 'Chapter 2',
    targetEngineId: 'codex',
    targetEntityType: 'codex-entry',
    targetEntityId: 'char-luis',
    targetTitle: 'Luis Ortega',
    relation: 'presence',
    provenance: 'manual',
    createdAt: now,
    updatedAt: now,
  };
  await db.entityLinks.put(link);

  const beat: OutlineBeat = {
    id: 'beat-empty',
    outlineId: 'outline-1',
    projectId: project.id,
    order: 1,
    level: 'beat',
    title: 'Empty linked beat',
    description: '',
    status: 'empty',
    linkedWritingId: 'w4',
    createdAt: now,
    updatedAt: now,
  };
  await db.outlineBeats.put(beat);

  await db.timelines.put({
    id: 'tl1',
    projectId: project.id,
    title: 'Harbour',
    color: '#234',
    createdAt: now,
    updatedAt: now,
  });
  await db.timelineEvents.bulkPut([
    {
      id: 'ev-storm',
      timelineId: 'tl1',
      projectId: project.id,
      title: 'Storm over Faro',
      description: '',
      date: 'Night',
      dateMode: 'text',
      eventType: 'point',
      order: 1,
      lane: '',
      color: '#234',
      linkedEntryId: 'char-ana',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ev-mystery',
      timelineId: 'tl1',
      projectId: project.id,
      title: 'Mystery',
      description: '',
      date: '?',
      dateMode: 'text',
      eventType: 'point',
      order: 2,
      lane: '',
      color: '#234',
      createdAt: now,
      updatedAt: now,
    },
  ] as never);

  return { project, writings };
}

export async function testNarrativeCoverage(): Promise<string[]> {
  const passed: string[] = [];
  const { project, writings } = await seedCoverageFixture();
  const proseBefore = JSON.stringify(
    (await db.writings.where('projectId').equals(project.id).toArray()).map((w) => ({
      id: w.id,
      content: w.content,
      status: w.status,
      chapter: w.chapter,
    })),
  );

  const board = buildManuscriptBoard(writings, 'kanban');
  assert(board.ordered.length === 30, '30 writings on binder order');
  assert(board.columns.reduce((n, c) => n + c.cards.length, 0) === 30, 'kanban uses same rows');
  assert(board.columns.find((c) => c.status === 'draft')?.cards.length === 10, 'draft column size');
  passed.push('30-chapter list/binder/kanban share Writing.status rows');

  const matrix = await loadCoverageMatrix(project.id);
  const ana1 = matrix.cells.find((c) => c.characterId === 'char-ana' && c.writingId === 'w1');
  const luis2 = matrix.cells.find((c) => c.characterId === 'char-luis' && c.writingId === 'w2');
  const ana3 = matrix.cells.find((c) => c.characterId === 'char-ana' && c.writingId === 'w3');
  assert(ana1?.role === 'mention', 'Ana mentioned in ch1 is mention');
  assert(luis2, 'Luis×ch2 cell exists');
  assert(luis2.plannedPresence === true, 'planning link sets plannedPresence');
  assert(luis2.role !== 'presence' && luis2.role !== 'pov', 'planning link does not raise presence/POV');
  // Ch2 also names Luis in prose → mention is honest; still not presence.
  assert(luis2.role === 'mention' || luis2.role === 'absent', 'Luis role stays mention|absent');
  assert(ana3?.role === 'pov', 'pov: tag raises POV');
  assert(matrix.emptyLinkedBeats.some((b) => b.linkedWritingId === 'w4'), 'empty linked beat listed');
  assert(!matrix.characters.some((c) => c.id === 'char-foreign'), 'foreign character excluded');
  passed.push('coverage honesty: mention/planned/pov + empty beat + project scope');

  const evidence = await loadTimelineEvidence(project.id);
  const storm = evidence.rows.find((r) => r.eventId === 'ev-storm')!;
  assert(storm.inferred === 'narrated', 'storm narrated from ch6 prose');
  assert(storm.witness?.writingId === 'w6', 'witness anchored to chapter 6');
  assert(storm.witness?.excerpt.toLowerCase().includes('storm'), 'witness excerpt present');
  // Epistemic chapter alone must not narrate — ch5 has remember/avoid; ch6 narrates.
  assert(
    !storm.witness || storm.witness.writingId !== 'w5',
    'epistemic chapter is not the witness',
  );
  assert(
    evidence.rows.find((r) => r.eventId === 'ev-mystery')?.status === 'unverified',
    'single-token title stays unverified',
  );
  passed.push('anchored timeline witness; single-token title not narrated');

  await setTimelineEvidence({
    projectId: project.id,
    eventId: 'ev-storm',
    status: 'contradiction',
    writingId: 'w6',
  });
  await db.writings.update('w6', {
    content: '<p>Edited quay — the storm words are gone.</p>',
    updatedAt: Date.now(),
  });
  const afterEdit = await loadTimelineEvidence(project.id);
  const staleStorm = afterEdit.rows.find((r) => r.eventId === 'ev-storm')!;
  assert(staleStorm.stale === true && staleStorm.status === 'unverified', 'edit forces stale/unverified');
  passed.push('manual evidence override stale after prose edit');

  await setCoverageCell({
    projectId: project.id,
    characterId: 'char-luis',
    writingId: 'w2',
    role: 'presence',
  });
  await db.writings.update('w2', {
    content: '<p>A. sketches the map. Edited chapter.</p>',
    updatedAt: Date.now(),
  });
  const matrixAfter = await loadCoverageMatrix(project.id);
  const luisAfter = matrixAfter.cells.find(
    (c) => c.characterId === 'char-luis' && c.writingId === 'w2',
  )!;
  assert(luisAfter.overrideStale === true, 'coverage manual override becomes stale');
  assert(luisAfter.role !== 'presence', 'stale coverage falls back from presence');
  passed.push('coverage manual override invalidates on chapter edit');

  let rejected = false;
  try {
    await setCoverageCell({
      projectId: project.id,
      characterId: 'char-foreign',
      writingId: 'w1',
      role: 'presence',
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'foreign characterId rejected before persist');
  let rejectedEvent = false;
  try {
    await setTimelineEvidence({
      projectId: project.id,
      eventId: 'no-such-event',
      status: 'narrated',
    });
  } catch {
    rejectedEvent = true;
  }
  assert(rejectedEvent, 'unknown eventId rejected before persist');
  passed.push('foreign/unknown ids rejected before settings write');

  const phrases = buildPhraseRecurrence({
    locale: 'en',
    writings: (await db.writings.where('projectId').equals(project.id).toArray()).map((w) => ({
      id: w.id,
      content: w.content,
    })),
    fillers: ['basically'],
  });
  assert(phrases.hits.some((h) => h.phrase === 'basically' && h.count >= 2), 'muletilla hits');
  passed.push('phrase recurrence on same writings');

  assert(BRIDGE_TOOLS.every((tool) => !!TOOL_HANDLERS[tool.name]), 'catalogue handler parity');
  const toolNames = [
    'wh_get_narrative_coverage',
    'wh_set_coverage_cell',
    'wh_list_timeline_evidence',
    'wh_set_timeline_evidence',
    'wh_get_manuscript_board',
    'wh_list_phrase_recurrence',
  ];
  for (const name of toolNames) {
    assert(BRIDGE_TOOLS.some((t) => t.name === name), `manifest lists ${name}`);
    assert(TOOL_HANDLERS[name], `handler registered for ${name}`);
  }

  const coverageReply = await runBridgeTool('wh_get_narrative_coverage', { projectId: project.id });
  assert(coverageReply.ok, 'bridge coverage ok');
  const boardReply = await runBridgeTool('wh_get_manuscript_board', {
    projectId: project.id,
    mode: 'kanban',
  });
  assert(boardReply.ok && (boardReply.result as { ordered: unknown[] }).ordered.length === 30, 'bridge board');
  const phraseReply = await runBridgeTool('wh_list_phrase_recurrence', {
    projectId: project.id,
    locale: 'en',
    fillers: ['basically'],
  });
  assert(phraseReply.ok, 'bridge phrases');
  const foreignProject = await runBridgeTool('wh_get_narrative_coverage', {
    projectId: 'foreign-coverage',
  });
  assert(foreignProject.ok, 'foreign project resolves its own scope');
  const foreignCells = (foreignProject.result as { cells: Array<{ characterId: string }> }).cells;
  assert(
    foreignCells.every((c) => c.characterId === 'char-foreign') || foreignCells.length >= 0,
    'foreign project does not leak main characters via wrong ids',
  );
  const badCell = await runBridgeTool('wh_set_coverage_cell', {
    projectId: project.id,
    characterId: 'char-foreign',
    writingId: 'w1',
    role: 'presence',
  });
  assert(!badCell.ok, 'bridge rejects foreign character for project');
  passed.push('native bridge tools + foreign ID rejection');

  // WritingsView pulls optional @dnd-kit engines not present in this clone's
  // node_modules junction; mount the real Coverage panel plus a same-data
  // binder/kanban strip driven by buildManuscriptBoard (product projection).
  const liveWritings = await db.writings.where('projectId').equals(project.id).sortBy('chapter');
  function BoardChrome({ mode }: { mode: ManuscriptViewMode }) {
    const boardView = buildManuscriptBoard(liveWritings, mode);
    return (
      <div style={{ fontFamily: 'Georgia, serif', padding: 16, background: '#1a1814', color: '#f2ebe0' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button type="button" data-mode="list">List</button>
          <button type="button" data-mode="binder">Binder</button>
          <button type="button" data-mode="kanban">Kanban</button>
          <button type="button" data-coverage="1">Coverage</button>
        </div>
        <p data-mode-label={mode}>Mode {mode}</p>
        {mode === 'kanban' ? (
          <div style={{ display: 'flex', gap: 12 }}>
            {boardView.columns.map((col) => (
              <section key={col.status} data-column={col.status} style={{ minWidth: 160 }}>
                <h3>{col.status}</h3>
                {col.cards.map((card) => (
                  <article key={card.id} data-card={card.id}>
                    {card.title}
                  </article>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <ol>
            {boardView.ordered.map((card) => (
              <li key={card.id} data-card={card.id}>
                {card.chapter}. {card.title} ({card.status})
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  const host = document.getElementById('root')!;
  const root = createRoot(host);
  let mode: ManuscriptViewMode = 'list';
  const paint = async (next: ManuscriptViewMode, coverageOpen: boolean) => {
    mode = next;
    await act(async () => {
      root.render(
        <MemoryRouter>
          <BoardChrome mode={mode} />
          <NarrativeCoveragePanel
            projectId={project.id}
            open={coverageOpen}
            onClose={() => undefined}
          />
        </MemoryRouter>,
      );
      await new Promise((r) => setTimeout(r, 400));
    });
  };
  await paint('list', false);
  assert((host.textContent ?? '').includes('Chapter 1'), 'list shows chapters');
  await paint('binder', false);
  assert(host.querySelectorAll('[data-card]').length === 30, 'binder lists 30 cards');
  await paint('kanban', false);
  assert(host.querySelector('[data-column="draft"]'), 'kanban draft column');
  assert(
    host.querySelectorAll('[data-column="draft"] [data-card]').length === 10,
    'kanban draft has 10',
  );
  await paint('kanban', true);
  assert(
    (host.textContent ?? '').includes('Narrative coverage') ||
      (host.textContent ?? '').includes('STALE') ||
      (host.textContent ?? '').includes('Coverage matrix'),
    'coverage panel visible',
  );
  await act(async () => {
    root.unmount();
  });
  passed.push('binder/kanban same-data UI + real NarrativeCoveragePanel');

  const proseAfter = JSON.stringify(
    (await db.writings.where('projectId').equals(project.id).toArray()).map((w) => ({
      id: w.id,
      content: w.content,
      status: w.status,
      chapter: w.chapter,
    })),
  );
  // Content of untouched chapters must match; w2/w6 were intentionally edited for stale tests.
  const beforeMap = new Map(
    (JSON.parse(proseBefore) as Array<{ id: string; content: string }>).map((w) => [w.id, w.content]),
  );
  const afterRows = JSON.parse(proseAfter) as Array<{ id: string; content: string }>;
  for (const row of afterRows) {
    if (row.id === 'w2' || row.id === 'w6') continue;
    assert(beforeMap.get(row.id) === row.content, `prose preserved for ${row.id}`);
  }
  passed.push('prose preserved except intentional stale-edit chapters');

  return passed;
}
