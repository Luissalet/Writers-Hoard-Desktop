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
  ExternalLink,
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
  externalLinks!: Table<ExternalLink>;
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
  }
}

export const db = new WritersHoardDB();
