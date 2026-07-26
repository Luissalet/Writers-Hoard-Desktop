import Dexie, { type Table } from 'dexie';
import type {
  Project,
  CodexEntry,
  Timeline,
  TimelineEvent,
  TimelineConnection,
  YarnBoard,
  YarnNode,
  YarnEdge,
  WorldMap,
  MapPin,
  ImageCollection,
  InspirationImage,
  Writing,
  Tag,
  AppSettings,
} from '../types';
import type { Storyboard, StoryboardPanel, StoryboardConnector } from '@/engines/storyboard/types';
import type { Scene, DialogBlock, SceneCast } from '@/engines/dialog-scene/types';
import type { VideoPlan, VideoSegment } from '@/engines/video-planner/types';
import type { Snapshot } from '@/engines/scrapper/types';
import type { Biography, BiographyFact } from '@/engines/biography/types';
import type { DiaryEntry } from '@/engines/diary/types';
import type { Outline, OutlineBeat } from '@/engines/outline/types';
import type { WritingSession, WritingGoal } from '@/engines/writing-stats/types';
import type { BrainstormBoard, BrainstormItem, BrainstormConnection } from '@/engines/brainstorm/types';
import type { CharacterArc, ArcBeat } from '@/engines/character-arc/types';
import type { Relationship } from '@/engines/relationships/types';
import type { Seed, Payoff } from '@/engines/seeds/types';
import type { Annotation, AnnotationReference } from '@/engines/annotations/types';
import type { WritingSnapshot } from '@/engines/writings/snapshotTypes';
import type { GeneratedWorld, WorldSnapshot, WorldWaypoint } from '@/engines/worldgen/types';
import type { Note } from '@/engines/notes/types';
import { legacyLinksToSnapshots } from '@/engines/scrapper/legacyLinks';

export class WritersHoardDB extends Dexie {
  projects!: Table<Project>;
  codexEntries!: Table<CodexEntry>;
  writings!: Table<Writing>;
  timelines!: Table<Timeline>;
  timelineEvents!: Table<TimelineEvent>;
  timelineConnections!: Table<TimelineConnection>;
  yarnBoards!: Table<YarnBoard>;
  yarnNodes!: Table<YarnNode>;
  yarnEdges!: Table<YarnEdge>;
  worldMaps!: Table<WorldMap>;
  mapPins!: Table<MapPin>;
  imageCollections!: Table<ImageCollection>;
  inspirationImages!: Table<InspirationImage>;
  tags!: Table<Tag>;
  settings!: Table<AppSettings>;
  storyboards!: Table<Storyboard>;
  storyboardPanels!: Table<StoryboardPanel>;
  storyboardConnectors!: Table<StoryboardConnector>;
  scenes!: Table<Scene>;
  dialogBlocks!: Table<DialogBlock>;
  sceneCasts!: Table<SceneCast>;
  videoPlans!: Table<VideoPlan>;
  videoSegments!: Table<VideoSegment>;
  snapshots!: Table<Snapshot>;
  biographies!: Table<Biography>;
  biographyFacts!: Table<BiographyFact>;
  diaryEntries!: Table<DiaryEntry>;
  outlines!: Table<Outline>;
  outlineBeats!: Table<OutlineBeat>;
  writingSessions!: Table<WritingSession>;
  writingGoals!: Table<WritingGoal>;
  brainstormBoards!: Table<BrainstormBoard>;
  brainstormItems!: Table<BrainstormItem>;
  brainstormConnections!: Table<BrainstormConnection>;
  characterArcs!: Table<CharacterArc>;
  arcBeats!: Table<ArcBeat>;
  relationships!: Table<Relationship>;
  seeds!: Table<Seed>;
  payoffs!: Table<Payoff>;
  annotations!: Table<Annotation>;
  annotationReferences!: Table<AnnotationReference>;
  writingSnapshots!: Table<WritingSnapshot>;
  generatedWorlds!: Table<GeneratedWorld>;
  worldWaypoints!: Table<WorldWaypoint>;
  worldSnapshots!: Table<WorldSnapshot>;
  notes!: Table<Note>;

  constructor() {
    super('WritersHoardDB');
    this.version(2).stores({
      projects: 'id, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
    });
    this.version(3).stores({
      projects: 'id, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
      settings: 'id, key',
    });

    this.version(4).stores({
      projects: 'id, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
      settings: 'id, key',
    }).upgrade(tx => {
      // Migrate linkedEntryId -> linkedEntryIds
      return tx.table('inspirationImages').toCollection().modify(img => {
        if (img.linkedEntryId && !img.linkedEntryIds) {
          img.linkedEntryIds = [img.linkedEntryId];
        }
        if (!img.linkedEntryIds) {
          img.linkedEntryIds = [];
        }
      });
    });

    this.version(5).stores({
      projects: 'id, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
      settings: 'id, key',
      storyboards: 'id, projectId',
      storyboardPanels: 'id, projectId, storyboardId, order',
      storyboardConnectors: 'id, storyboardId, sourceId, targetId',
    });

    this.version(6).stores({
      projects: 'id, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
      settings: 'id, key',
      storyboards: 'id, projectId',
      storyboardPanels: 'id, projectId, storyboardId, order',
      storyboardConnectors: 'id, storyboardId, sourceId, targetId',
      scenes: 'id, projectId, order',
      dialogBlocks: 'id, sceneId, projectId, order',
      sceneCasts: 'id, sceneId',
    });

    this.version(7).stores({
      projects: 'id, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
      settings: 'id, key',
      storyboards: 'id, projectId',
      storyboardPanels: 'id, projectId, storyboardId, order',
      storyboardConnectors: 'id, storyboardId, sourceId, targetId',
      scenes: 'id, projectId, order',
      dialogBlocks: 'id, sceneId, projectId, order',
      sceneCasts: 'id, sceneId',

    });

    this.version(8).stores({
      projects: 'id, mode, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
      settings: 'id, key',
      storyboards: 'id, projectId',
      storyboardPanels: 'id, projectId, storyboardId, order',
      storyboardConnectors: 'id, storyboardId, sourceId, targetId',
      scenes: 'id, projectId, order',
      dialogBlocks: 'id, sceneId, projectId, order',
      sceneCasts: 'id, sceneId',

      videoPlans: 'id, projectId',
      videoSegments: 'id, videoPlanId, projectId, order',
      snapshots: 'id, projectId, source, status, createdAt',
      biographies: 'id, projectId',
      biographyFacts: 'id, biographyId, projectId, order, category',
    });

    // v9: Backfill existing projects with mode + enabledEngines
    this.version(9).stores({
      projects: 'id, mode, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
      settings: 'id, key',
      storyboards: 'id, projectId',
      storyboardPanels: 'id, projectId, storyboardId, order',
      storyboardConnectors: 'id, storyboardId, sourceId, targetId',
      scenes: 'id, projectId, order',
      dialogBlocks: 'id, sceneId, projectId, order',
      sceneCasts: 'id, sceneId',

      videoPlans: 'id, projectId',
      videoSegments: 'id, videoPlanId, projectId, order',
      snapshots: 'id, projectId, source, status, createdAt',
      biographies: 'id, projectId',
      biographyFacts: 'id, biographyId, projectId, order, category',
    }).upgrade(tx => {
      const defaultEngines = ['writings', 'codex', 'timeline', 'yarn-board', 'maps', 'gallery', 'links'];
      return tx.table('projects').toCollection().modify(project => {
        if (!project.mode) {
          project.mode = 'novelist';
        }
        if (!project.enabledEngines) {
          project.enabledEngines = defaultEngines;
        }
        if (!project.engineOrder) {
          project.engineOrder = defaultEngines;
        }
      });
    });

    // v10: Backfill timeline events with dateMode
    this.version(10).stores({
      projects: 'id, mode, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order, dateMode',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
      settings: 'id, key',
      storyboards: 'id, projectId',
      storyboardPanels: 'id, projectId, storyboardId, order',
      storyboardConnectors: 'id, storyboardId, sourceId, targetId',
      scenes: 'id, projectId, order',
      dialogBlocks: 'id, sceneId, projectId, order',
      sceneCasts: 'id, sceneId',

      videoPlans: 'id, projectId',
      videoSegments: 'id, videoPlanId, projectId, order',
      snapshots: 'id, projectId, source, status, createdAt',
      biographies: 'id, projectId',
      biographyFacts: 'id, biographyId, projectId, order, category',
    }).upgrade(tx => {
      return tx.table('timelineEvents').toCollection().modify(evt => {
        if (!evt.dateMode) {
          evt.dateMode = 'text';
        }
      });
    });

    // v11: Add diary entries table
    this.version(11).stores({
      projects: 'id, mode, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order, dateMode',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
      settings: 'id, key',
      storyboards: 'id, projectId',
      storyboardPanels: 'id, projectId, storyboardId, order',
      storyboardConnectors: 'id, storyboardId, sourceId, targetId',
      scenes: 'id, projectId, order',
      dialogBlocks: 'id, sceneId, projectId, order',
      sceneCasts: 'id, sceneId',

      videoPlans: 'id, projectId',
      videoSegments: 'id, videoPlanId, projectId, order',
      snapshots: 'id, projectId, source, status, createdAt',
      biographies: 'id, projectId',
      biographyFacts: 'id, biographyId, projectId, order, category',
      diaryEntries: 'id, projectId, entryDate, *tags, pinned',
    });

    // v12: Add outline tables
    this.version(12).stores({
      projects: 'id, mode, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order, dateMode',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
      settings: 'id, key',
      storyboards: 'id, projectId',
      storyboardPanels: 'id, projectId, storyboardId, order',
      storyboardConnectors: 'id, storyboardId, sourceId, targetId',
      scenes: 'id, projectId, order',
      dialogBlocks: 'id, sceneId, projectId, order',
      sceneCasts: 'id, sceneId',

      videoPlans: 'id, projectId',
      videoSegments: 'id, videoPlanId, projectId, order',
      snapshots: 'id, projectId, source, status, createdAt',
      biographies: 'id, projectId',
      biographyFacts: 'id, biographyId, projectId, order, category',
      diaryEntries: 'id, projectId, entryDate, *tags, pinned',
      outlines: 'id, projectId',
      outlineBeats: 'id, outlineId, projectId, order, level, parentId',
    });

    // v13: Add writing stats tables
    this.version(13).stores({
      projects: 'id, mode, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order, dateMode',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
      settings: 'id, key',
      storyboards: 'id, projectId',
      storyboardPanels: 'id, projectId, storyboardId, order',
      storyboardConnectors: 'id, storyboardId, sourceId, targetId',
      scenes: 'id, projectId, order',
      dialogBlocks: 'id, sceneId, projectId, order',
      sceneCasts: 'id, sceneId',

      videoPlans: 'id, projectId',
      videoSegments: 'id, videoPlanId, projectId, order',
      snapshots: 'id, projectId, source, status, createdAt',
      biographies: 'id, projectId',
      biographyFacts: 'id, biographyId, projectId, order, category',
      diaryEntries: 'id, projectId, entryDate, *tags, pinned',
      outlines: 'id, projectId',
      outlineBeats: 'id, outlineId, projectId, order, level, parentId',
      writingSessions: 'id, projectId, date, type, createdAt',
      writingGoals: 'id, projectId, type, active',
    });

    // v14: Add brainstorm tables
    this.version(14).stores({
      projects: 'id, mode, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order, dateMode',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
      settings: 'id, key',
      storyboards: 'id, projectId',
      storyboardPanels: 'id, projectId, storyboardId, order',
      storyboardConnectors: 'id, storyboardId, sourceId, targetId',
      scenes: 'id, projectId, order',
      dialogBlocks: 'id, sceneId, projectId, order',
      sceneCasts: 'id, sceneId',

      videoPlans: 'id, projectId',
      videoSegments: 'id, videoPlanId, projectId, order',
      snapshots: 'id, projectId, source, status, createdAt',
      biographies: 'id, projectId',
      biographyFacts: 'id, biographyId, projectId, order, category',
      diaryEntries: 'id, projectId, entryDate, *tags, pinned',
      outlines: 'id, projectId',
      outlineBeats: 'id, outlineId, projectId, order, level, parentId',
      writingSessions: 'id, projectId, date, type, createdAt',
      writingGoals: 'id, projectId, type, active',
      brainstormBoards: 'id, projectId',
      brainstormItems: 'id, boardId, projectId, type',
      brainstormConnections: 'id, boardId, sourceId, targetId',
    });

    // v15: Timeline overhaul — connections table, event types, timeline colors
    this.version(15).stores({
      projects: 'id, mode, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order, dateMode, eventType',
      timelineConnections: 'id, projectId, timelineId, sourceEventId, targetEventId',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
      settings: 'id, key',
      storyboards: 'id, projectId',
      storyboardPanels: 'id, projectId, storyboardId, order',
      storyboardConnectors: 'id, storyboardId, sourceId, targetId',
      scenes: 'id, projectId, order',
      dialogBlocks: 'id, sceneId, projectId, order',
      sceneCasts: 'id, sceneId',

      videoPlans: 'id, projectId',
      videoSegments: 'id, videoPlanId, projectId, order',
      snapshots: 'id, projectId, source, status, createdAt',
      biographies: 'id, projectId',
      biographyFacts: 'id, biographyId, projectId, order, category',
      diaryEntries: 'id, projectId, entryDate, *tags, pinned',
      outlines: 'id, projectId',
      outlineBeats: 'id, outlineId, projectId, order, level, parentId',
      writingSessions: 'id, projectId, date, type, createdAt',
      writingGoals: 'id, projectId, type, active',
      brainstormBoards: 'id, projectId',
      brainstormItems: 'id, boardId, projectId, type',
      brainstormConnections: 'id, boardId, sourceId, targetId',
    }).upgrade(tx => {
      // Backfill existing timeline events with eventType
      tx.table('timelineEvents').toCollection().modify(evt => {
        if (!evt.eventType) {
          // If event has an end date, it's a range; otherwise a point
          evt.eventType = evt.realDateEnd ? 'range' : 'point';
        }
      });
      // Backfill existing timelines with color
      tx.table('timelines').toCollection().modify(tl => {
        if (!tl.color) {
          tl.color = '#c4973b'; // default gold
        }
      });
    });

    // v16: Character Arcs, Relationship Matrix, Seeds & Payoffs
    this.version(16).stores({
      projects: 'id, mode, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order, dateMode, eventType',
      timelineConnections: 'id, projectId, timelineId, sourceEventId, targetEventId',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
      settings: 'id, key',
      storyboards: 'id, projectId',
      storyboardPanels: 'id, projectId, storyboardId, order',
      storyboardConnectors: 'id, storyboardId, sourceId, targetId',
      scenes: 'id, projectId, order',
      dialogBlocks: 'id, sceneId, projectId, order',
      sceneCasts: 'id, sceneId',

      videoPlans: 'id, projectId',
      videoSegments: 'id, videoPlanId, projectId, order',
      snapshots: 'id, projectId, source, status, createdAt',
      biographies: 'id, projectId',
      biographyFacts: 'id, biographyId, projectId, order, category',
      diaryEntries: 'id, projectId, entryDate, *tags, pinned',
      outlines: 'id, projectId',
      outlineBeats: 'id, outlineId, projectId, order, level, parentId',
      writingSessions: 'id, projectId, date, type, createdAt',
      writingGoals: 'id, projectId, type, active',
      brainstormBoards: 'id, projectId',
      brainstormItems: 'id, boardId, projectId, type',
      brainstormConnections: 'id, boardId, sourceId, targetId',
      characterArcs: 'id, projectId, characterId, templateId, status',
      arcBeats: 'id, arcId, projectId, order, stage',
      relationships: 'id, projectId, entityAId, entityBId, kind, state',
      seeds: 'id, projectId, kind, status, plantedAt',
      payoffs: 'id, seedId, projectId, paidAt',
    });

    // v17: Interconnectedness — annotations (margin notes) + reference payload
    this.version(17).stores({
      projects: 'id, mode, type, parentId, status, updatedAt',
      codexEntries: 'id, projectId, type, *tags, updatedAt',
      writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
      timelines: 'id, projectId',
      timelineEvents: 'id, projectId, timelineId, order, dateMode, eventType',
      timelineConnections: 'id, projectId, timelineId, sourceEventId, targetEventId',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      worldMaps: 'id, projectId',
      mapPins: 'id, projectId, mapId',
      imageCollections: 'id, projectId',
      inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
      externalLinks: 'id, projectId, type, *tags',
      tags: 'id, name',
      settings: 'id, key',
      storyboards: 'id, projectId',
      storyboardPanels: 'id, projectId, storyboardId, order',
      storyboardConnectors: 'id, storyboardId, sourceId, targetId',
      scenes: 'id, projectId, order',
      dialogBlocks: 'id, sceneId, projectId, order',
      sceneCasts: 'id, sceneId',

      videoPlans: 'id, projectId',
      videoSegments: 'id, videoPlanId, projectId, order',
      snapshots: 'id, projectId, source, status, createdAt',
      biographies: 'id, projectId',
      biographyFacts: 'id, biographyId, projectId, order, category',
      diaryEntries: 'id, projectId, entryDate, *tags, pinned',
      outlines: 'id, projectId',
      outlineBeats: 'id, outlineId, projectId, order, level, parentId',
      writingSessions: 'id, projectId, date, type, createdAt',
      writingGoals: 'id, projectId, type, active',
      brainstormBoards: 'id, projectId',
      brainstormItems: 'id, boardId, projectId, type',
      brainstormConnections: 'id, boardId, sourceId, targetId',
      characterArcs: 'id, projectId, characterId, templateId, status',
      arcBeats: 'id, arcId, projectId, order, stage',
      relationships: 'id, projectId, entityAId, entityBId, kind, state',
      seeds: 'id, projectId, kind, status, plantedAt',
      payoffs: 'id, seedId, projectId, paidAt',
      // New in v17: shell table keyed by (projectId, sourceEngineId, sourceEntityId).
      // `isOrphaned` is indexed so the project-level "needs reanchor" dashboard
      // can pull orphans cheaply.
      annotations: 'id, projectId, sourceEngineId, sourceEntityId, isOrphaned, noteType, updatedAt, [sourceEngineId+sourceEntityId]',
      // `annotationId` is unique in v1 (1 reference per annotation). Index on
      // (targetEngineId, targetEntityId) powers useEntityBacklinks.
      annotationReferences: 'id, &annotationId, targetEngineId, targetEntityId, [targetEngineId+targetEntityId]',
    });

    // v18: Writing version history — automatic snapshots with restore.
    // Additive table only; every other store is inherited unchanged from v17.
    this.version(18).stores({
      writingSnapshots: 'id, writingId, projectId, createdAt',
    });

    // v19: World Generator — worlds stored as seed+params (deterministic
    // regeneration), waypoints as plain rows. Additive tables only.
    this.version(19).stores({
      generatedWorlds: 'id, projectId, updatedAt',
      worldWaypoints: 'id, projectId, worldId',
    });

    // v20: the forged world, kept.
    //
    // Regenerating from the seed is deterministic and correct and takes
    // twenty-six seconds, and it ran on every single application start. This
    // table is a CACHE — quantised, compressed, keyed by the parameters it was
    // made from, and reforgeable from `generatedWorlds` at any time. It is
    // deliberately absent from the backup registry: eleven megabytes of derived
    // bytes have no business in an export.
    this.version(20).stores({
      worldSnapshots: 'worldId, savedAt',
    });

    // v21: Notes engine in, Links engine out.
    //
    // `notes` is the quick-capture table (short thoughts, quotes, stray
    // ideas). `projectId` doubles as the scope key: real project ids for
    // project notes, the `__inbox__` sentinel for captures made outside any
    // project — Dexie can't index undefined, so a sentinel beats a nullable
    // column here.
    //
    // The upgrade also retires Links: every `externalLinks` row becomes a
    // link-only Scrapper snapshot (Links stored url+title+notes+tags, an
    // exact subset of Snapshot), and 'links' is stripped from every project's
    // engine lists so no project boots pointing at an engine that no longer
    // registers. The table itself is dropped in v22 — deleting it here would
    // make it unreadable inside this very upgrade.
    this.version(21).stores({
      notes: 'id, projectId, kind, *tags, pinned, createdAt',
    }).upgrade(async (tx) => {
      const links = await tx.table('externalLinks').toArray();
      if (links.length) {
        const snapshots = legacyLinksToSnapshots(links);
        // bulkPut, not bulkAdd: a half-finished upgrade that runs again must
        // not explode on ids it already wrote.
        if (snapshots.length) await tx.table('snapshots').bulkPut(snapshots);
      }
      // Rewrite each project's engine lists: drop 'links'; make sure the
      // engine its data moved INTO is actually visible; and switch every
      // existing project on to Notes, which is new and would otherwise be
      // invisible until the user went looking for it in the Engine Manager
      // (where it can just as easily be switched back off).
      const hadLinks = links.length > 0;
      const rewrite = (list: unknown): string[] | undefined => {
        if (!Array.isArray(list)) return undefined;
        const next = (list as string[]).filter((e) => e !== 'links');
        if (hadLinks && !next.includes('scrapper')) next.push('scrapper');
        if (!next.includes('notes')) next.push('notes');
        return next;
      };
      await tx.table('projects').toCollection().modify((project) => {
        const enabled = rewrite(project.enabledEngines);
        if (enabled) project.enabledEngines = enabled;
        const order = rewrite(project.engineOrder);
        if (order) project.engineOrder = order;
      });
    });

    // v22: drop the now-empty `externalLinks` store. Separate version on
    // purpose — Dexie applies each version's schema diff before running that
    // version's upgrader, so v21 still sees the table it needs to read.
    this.version(22).stores({
      externalLinks: null,
    });
  }
}

export const db = new WritersHoardDB();
