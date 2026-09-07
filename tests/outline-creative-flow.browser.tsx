import { act, useEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate, useLocation } from 'react-router-dom';
import { db } from '@/db';
import { createOutlineFromTemplate } from '@/engines/outline/operations';
import { BEAT_SHEET_TEMPLATES, type OutlineBeat } from '@/engines/outline/types';
import BeatList from '@/engines/outline/components/BeatList';
import DialogSceneEngine from '@/engines/dialog-scene/components/DialogSceneEngine';
import { autoNumberScenes, createScene, deleteScene, reorderScenes } from '@/engines/dialog-scene/operations';
import type { Scene } from '@/engines/dialog-scene/types';
import type { Project, Writing } from '@/types';
import { installNavigator } from '@/engines/_shared/anchoring';
import { t } from '@/i18n/useTranslation';
import StoryboardView from '@/engines/storyboard/components/StoryboardView';
import type { StoryboardPanel } from '@/engines/storyboard/types';
import VideoPlanView from '@/engines/video-planner/components/VideoPlanView';
import type { VideoSegment } from '@/engines/video-planner/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const wait = (ms = 25) => new Promise(resolve => window.setTimeout(resolve, ms));

function Routed({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => { installNavigator(navigate); }, [navigate]);
  return <><output data-testid="route">{location.pathname}{location.search}</output>{children}</>;
}

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function testOutlineCreativeFlow(): Promise<string[]> {
  const projectId = 'outline creative/fixture';
  const host = document.getElementById('root');
  assert(host, 'Missing test root');
  const project: Project = {
    id: projectId, title: 'Creative outline', mode: 'custom', type: 'idea', color: '#fff', description: '',
    status: 'draft', enabledEngines: ['outline', 'dialog-scene', 'writings'], engineOrder: ['outline', 'dialog-scene', 'writings'],
    createdAt: 1, updatedAt: 1,
  };
  const scene = (id: string, order: number): Scene => ({ id, projectId, title: id, order, tags: [], createdAt: 1, updatedAt: 1 });
  let root: Root | null = null;
  const unmount = async () => { await act(async () => { root?.unmount(); root = null; await wait(); }); };
  const mount = async (children: ReactNode) => {
    await act(async () => {
      root = createRoot(host);
      root.render(<MemoryRouter><Routed>{children}</Routed></MemoryRouter>);
      await wait();
    });
    await act(async () => { await wait(); });
  };
  let creationCount = 0;
  const rejectSecondBeat = () => {
    creationCount++;
    if (creationCount === 2) throw new Error('Injected beat write failure');
  };
  try {
    await db.projects.put(project);
    db.outlineBeats.hook('creating', rejectSecondBeat);
    let rejected = false;
    try { await createOutlineFromTemplate(projectId, 'Partial must not exist', 'three-act', t); } catch { rejected = true; }
    db.outlineBeats.hook('creating').unsubscribe(rejectSecondBeat);
    assert(rejected, 'Injected template failure was swallowed');
    assert(await db.outlines.where('projectId').equals(projectId).count() === 0, 'Failed template left a partial outline');
    assert(await db.outlineBeats.where('projectId').equals(projectId).count() === 0, 'Failed template left partial beats');
    const outline = await createOutlineFromTemplate(projectId, 'Complete structure', 'three-act', t);
    const beats = await db.outlineBeats.where('outlineId').equals(outline.id).sortBy('order');
    const template = BEAT_SHEET_TEMPLATES.find(row => row.id === 'three-act')!;
    assert(beats.length === template.beats.length && beats[0].title === t(template.beats[0].titleKey), 'Template lost beats or translated text');

    await createScene(scene('scene first', 0));
    await createScene(scene('scene/second', 1));
    assert((await db.scenes.get('scene/second'))?.sceneNumber === 2, 'Create returned before scene numbering');
    await reorderScenes(projectId, ['scene/second', 'scene first']);
    assert((await db.scenes.get('scene/second'))?.sceneNumber === 1, 'Reorder returned before numbering');
    await db.scenes.update('scene first', { isLocked: true, sceneNumber: 10 });
    await createScene(scene('scene third', 2));
    assert((await db.scenes.get('scene third'))?.sceneNumber === 11, 'Numbering ignored a locked scene');
    await deleteScene('scene/second');
    assert((await db.scenes.get('scene first'))?.sceneNumber === 10, 'Deletion renumbered a locked scene');
    const before = (await db.scenes.get('scene third'))?.updatedAt;
    await autoNumberScenes(projectId);
    assert((await db.scenes.get('scene third'))?.updatedAt === before, 'No-op numbering rewrote timestamps');

    const writing = { id: 'writing/target', projectId, title: 'The reveal', content: '', tags: [], status: 'draft', order: 0, wordCount: 12, createdAt: 1, updatedAt: 1 } as Writing;
    const linkedScene = (await db.scenes.get('scene first'))!;
    const linkedBeat: OutlineBeat = { ...beats[0], linkedSceneId: linkedScene.id, linkedWritingId: writing.id };
    const renderBeats = (beat: OutlineBeat) => <BeatList projectId={projectId} outlineId={outline.id} beats={[beat]} scenes={[linkedScene]} writings={[writing]} onAddBeat={() => {}} onUpdateBeat={() => {}} onDeleteBeat={() => {}} />;
    await mount(renderBeats(linkedBeat));
    const findLink = (title: string) => [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === t('outline.beat.openLinked').replace('{name}', title));
    const sceneLink = findLink(linkedScene.title);
    assert(sceneLink, 'Linked scene chip is not an accessible control');
    await act(async () => { sceneLink.click(); });
    assert(host.querySelector('output')?.textContent === `/project/${encodeURIComponent(projectId)}/dialog-scene?entity=${encodeURIComponent(linkedScene.id)}`, 'Scene chip did not navigate to exact entity');
    const writingLink = findLink(writing.title);
    assert(writingLink, 'Linked chapter chip is not an accessible control');
    await act(async () => { writingLink.click(); });
    assert(host.querySelector('output')?.textContent === `/project/${encodeURIComponent(projectId)}/writings?writing=${encodeURIComponent(writing.id)}`, 'Chapter chip did not navigate to exact writing');
    await unmount();
    await mount(renderBeats({ ...linkedBeat, wordTarget: 1000 }));
    assert(findLink(writing.title), 'Adding a word target removed navigation to the writing');
    await unmount();

    await mount(<DialogSceneEngine projectId={projectId} />);
    const newScene = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === t('dialogScene.newScene'));
    assert(newScene, 'Missing new scene control');
    await act(async () => { newScene.click(); await wait(); });
    const titleInput = [...host.querySelectorAll('input')].find(input => input.placeholder === t('dialogScene.sceneTitlePlaceholder'));
    assert(titleInput, 'New scene form did not open');
    await act(async () => { setInput(titleInput, 'A newly explored scene'); });
    await act(async () => {
      titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await wait(100);
    });
    await act(async () => { await wait(100); });
    const created = await db.scenes.where('projectId').equals(projectId).filter(row => row.title === 'A newly explored scene').toArray();
    assert(created.length === 1 && created[0].sceneNumber !== undefined, 'Creating a scene duplicated it or left it unnumbered');
    assert([...host.querySelectorAll('button')].some(button => button.textContent?.trim() === t('dialogScene.back')), 'New scene was saved without opening its editor');
    await unmount();

    let rejectPanel = true;
    const addedPanels: StoryboardPanel[] = [];
    const board = { id: 'draft-board', projectId, title: 'Visual structure', columns: 3, createdAt: 1, updatedAt: 1 };
    function BoardHarness() {
      const [panels, setPanels] = useState<StoryboardPanel[]>([]);
      return <StoryboardView storyboard={board} panels={panels} connectors={[]}
        onAddPanel={async panel => {
          await wait();
          if (rejectPanel) throw new Error('Injected panel write failure');
          addedPanels.push(panel);
          setPanels(rows => [...rows, panel]);
        }}
        onUpdatePanel={() => { throw new Error('A new panel must be inserted, not updated'); }}
        onDeletePanel={() => {}} onReorderPanels={() => {}} onAddConnector={() => {}}
        onUpdateConnector={() => {}} onDeleteConnector={() => {}} onUpdateStoryboard={() => {}} />;
    }
    const buttonNamed = (name: string) => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === name);
    await mount(<BoardHarness />);
    await act(async () => { buttonNamed(t('storyboard.addPanel'))!.click(); await wait(); });
    assert(document.querySelector('[role="dialog"]'), 'First panel editor did not open from empty state');
    assert(addedPanels.length === 0, 'Opening the editor persisted an empty panel');
    await act(async () => { buttonNamed(t('common.cancel'))!.click(); await wait(); });
    assert(addedPanels.length === 0 && !document.querySelector('[role="dialog"]'), 'Cancelling left an empty panel');
    await act(async () => { buttonNamed(t('storyboard.addPanel'))!.click(); await wait(); });
    const subtitle = [...document.querySelectorAll('input')].find(input => input.placeholder === t('storyboard.form.subtitlePlaceholder'))!;
    await act(async () => { setInput(subtitle, 'The doorway opens'); });
    await act(async () => { buttonNamed(t('storyboard.form.savePanel'))!.click(); await wait(60); });
    assert(document.querySelector('[role="dialog"]') && subtitle.value === 'The doorway opens' && addedPanels.length === 0, 'Failed panel insertion lost its draft');
    rejectPanel = false;
    await act(async () => {
      const save = buttonNamed(t('storyboard.form.savePanel'))!;
      save.click(); save.click(); await wait(60);
    });
    assert(Number(addedPanels.length) === 1 && addedPanels[0].subtitle === 'The doorway opens', 'Panel retry failed or duplicated the draft');
    assert(!document.querySelector('[role="dialog"]'), 'Successful panel insertion left editor open');
    await unmount();

    let rejectSegment = true;
    let segmentAttempts = 0;
    const addedSegments: VideoSegment[] = [];
    function VideoHarness() {
      const [segments, setSegments] = useState<VideoSegment[]>([]);
      return <VideoPlanView plan={{ id: 'video-fixture', projectId, title: 'Film idea', createdAt: 1, updatedAt: 1 }} segments={segments}
        onAddSegment={async segment => {
          segmentAttempts++;
          await wait();
          if (rejectSegment) throw new Error('Injected segment failure');
          addedSegments.push(segment);
          setSegments(rows => [...rows, segment]);
        }} onUpdateSegment={async () => { throw new Error('Injected segment update failure'); }} onDeleteSegment={() => {}} onReorderSegments={() => {}} />;
    }
    await mount(<VideoHarness />);
    await act(async () => { buttonNamed(t('videoPlanner.addSegment'))!.click(); await wait(60); });
    assert(addedSegments.length === 0 && !document.querySelector('[role="dialog"]') && document.querySelector('[role="alert"]'), 'Rejected segment creation falsely opened editor or hid failure');
    rejectSegment = false;
    await act(async () => {
      const add = buttonNamed(t('videoPlanner.addSegment'))!;
      add.click(); add.click(); await wait(60);
    });
    assert(segmentAttempts === 2 && Number(addedSegments.length) === 1, 'Repeated segment click created duplicates');
    const segmentTitle = [...document.querySelectorAll('input')].find(input => input.placeholder === t('videoPlanner.segment.titlePlaceholder'));
    assert(segmentTitle?.value === addedSegments[0].title && document.querySelector('[role="dialog"]'), 'Segment creation did not open the exact resulting editor');
    await act(async () => { setInput(segmentTitle, 'Opening image'); });
    await act(async () => { buttonNamed(t('common.save'))!.click(); await wait(60); });
    assert(document.querySelector('[role="dialog"]') && segmentTitle.value === 'Opening image', 'Failed segment update discarded the creative draft');
    return ['Outline: template insertion rolls back completely and persists localized beats', 'Outline: scene and writing chips navigate to exact linked entities', 'Scenes: atomic numbering respects locks; creation opens the editor once', 'Storyboard: cancellation leaves no empty panel; failed creation keeps the draft and retry inserts once', 'Video: creation opens the saved segment, rejects duplicates, and retains failed edits'];
  } finally {
    db.outlineBeats.hook('creating').unsubscribe(rejectSecondBeat);
    await unmount();
    const scenes = await db.scenes.where('projectId').equals(projectId).primaryKeys();
    await db.sceneCasts.where('sceneId').anyOf(scenes).delete();
    await db.dialogBlocks.where('projectId').equals(projectId).delete();
    await db.scenes.where('projectId').equals(projectId).delete();
    await db.outlineBeats.where('projectId').equals(projectId).delete();
    await db.outlines.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  }
}
