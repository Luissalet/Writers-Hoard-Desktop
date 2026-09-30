import Dexie, { type Table } from 'dexie';
import type {
  Project,
  CodexEntry,
  Timeline,
  TimelineEvent,
  TimelineConnection,
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
import type { CharacterArc, ArcBeat } from '@/engines/character-arc/types';
import type { Relationship } from '@/engines/relationships/types';
import type { Seed, Payoff } from '@/engines/seeds/types';
import type { AtlasDivergence, AtlasPlace } from '@/engines/real-atlas/types';
import type { Annotation, AnnotationReference } from '@/engines/annotations/types';
import type { WritingSnapshot } from '@/engines/writings/snapshotTypes';
import type { CanonTileRow, GeneratedWorld, RenderedTileRow, WorldSnapshot, WorldWaypoint } from '@/engines/worldgen/types';
import type { Note } from '@/engines/notes/types';
import type { Board, BoardEdge, BoardLayer, BoardNode, BoardView } from '@/engines/board/types';
import type {
  Citation,
  ConversionReceipt,
  EntityLink,
  PublishingProfile,
} from '@/types/projectTools';
import { legacyLinksToSnapshots } from '@/engines/scrapper/legacyLinks';
import type { AiMessage, AiProjectSettings, AiThread } from '@/services/copilot/types';
import type { VisualRef } from '@/types/visualRef';
import type { ImageRecipeRow } from '@/services/aiRuntime/recipe';
import type {
  JudgeFinding,
  JudgeRun,
  ProjectReferenceLink,
  ReferenceDocument,
  ReferenceLens,
  ReferenceSection,
} from '@/services/judge/types';
import type {
  BranchPromotionReceipt,
  CreativeBranch,
  CreativeBranchDelta,
} from '@/services/branching/types';
import type { NarrativeMoment, StoryClaim } from '@/services/storyState/types';
import type { SharedCanonEntity, SharedEntityBinding } from '@/services/sharedUniverse/types';
import type {
  EnrichmentRun,
  InquiryCase,
  InquiryClaim,
  InquiryHypothesis,
  InquiryRating,
} from '@/engines/inquiry/types';
import { migrateLegacyBoards } from './legacyBoardMigration';

/** Single source of truth for migration and compatibility tests. */
export const CURRENT_DB_VERSION = 35;

export class WritersHoardDB extends Dexie {
  projects!: Table<Project>;
  codexEntries!: Table<CodexEntry>;
  writings!: Table<Writing>;
  timelines!: Table<Timeline>;
  timelineEvents!: Table<TimelineEvent>;
  timelineConnections!: Table<TimelineConnection>;
  boards!: Table<Board>;
  boardNodes!: Table<BoardNode>;
  boardEdges!: Table<BoardEdge>;
  boardLayers!: Table<BoardLayer>;
  boardViews!: Table<BoardView>;
  worldMaps!: Table<WorldMap>;
  mapPins!: Table<MapPin>;
  atlasPlaces!: Table<AtlasPlace>;
  atlasDivergences!: Table<AtlasDivergence>;
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
  canonTiles!: Table<CanonTileRow>;
  renderedTiles!: Table<RenderedTileRow>;
  notes!: Table<Note>;
  entityLinks!: Table<EntityLink>;
  citations!: Table<Citation>;
  publishingProfiles!: Table<PublishingProfile>;
  conversionReceipts!: Table<ConversionReceipt>;
  aiThreads!: Table<AiThread>;
  aiMessages!: Table<AiMessage>;
  aiProjectSettings!: Table<AiProjectSettings>;
  visualRefs!: Table<VisualRef>;
  imageRecipes!: Table<ImageRecipeRow>;
  referenceDocuments!: Table<ReferenceDocument>;
  referenceSections!: Table<ReferenceSection>;
  referenceLenses!: Table<ReferenceLens>;
  projectReferenceLinks!: Table<ProjectReferenceLink>;
  judgeRuns!: Table<JudgeRun>;
  judgeFindings!: Table<JudgeFinding>;
  creativeBranches!: Table<CreativeBranch>;
  creativeBranchDeltas!: Table<CreativeBranchDelta>;
  branchPromotionReceipts!: Table<BranchPromotionReceipt>;
  narrativeMoments!: Table<NarrativeMoment>;
  storyClaims!: Table<StoryClaim>;
  sharedCanonEntities!: Table<SharedCanonEntity>;
  sharedEntityBindings!: Table<SharedEntityBinding>;
  inquiryCases!: Table<InquiryCase>;
  inquiryClaims!: Table<InquiryClaim>;
  inquiryHypotheses!: Table<InquiryHypothesis>;
  inquiryRatings!: Table<InquiryRating>;
  enrichmentRuns!: Table<EnrichmentRun>;

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
      const snapshots = legacyLinksToSnapshots(links);
      if (links.length) {
        // bulkPut, not bulkAdd: a half-finished upgrade that runs again must
        // not explode on ids it already wrote.
        if (snapshots.length) await tx.table('snapshots').bulkPut(snapshots);
      }
      // Rewrite each project's engine lists: drop 'links'; make sure the
      // engine its data moved INTO is actually visible; and switch every
      // existing project on to Notes, which is new and would otherwise be
      // invisible until the user went looking for it in the Engine Manager
      // (where it can just as easily be switched back off).
      const projectIdsWithLinks = new Set(snapshots.map((snapshot) => snapshot.projectId));
      const rewrite = (list: unknown, enableScrapper: boolean): string[] | undefined => {
        if (!Array.isArray(list)) return undefined;
        const next = (list as string[]).filter((e) => e !== 'links');
        if (enableScrapper && !next.includes('scrapper')) next.push('scrapper');
        if (!next.includes('notes')) next.push('notes');
        return next;
      };
      await tx.table('projects').toCollection().modify((project) => {
        const enableScrapper = projectIdsWithLinks.has(project.id);
        const enabled = rewrite(project.enabledEngines, enableScrapper);
        if (enabled) project.enabledEngines = enabled;
        const order = rewrite(project.engineOrder, enableScrapper);
        if (order) project.engineOrder = order;
      });
    });

    // v22: drop the now-empty `externalLinks` store. Separate version on
    // purpose — Dexie applies each version's schema diff before running that
    // version's upgrader, so v21 still sees the table it needs to read.
    this.version(22).stores({
      externalLinks: null,
    });

    // v23: cross-engine project tools. These tables are intentionally
    // project-scoped so deletion and transactional restore cover them through
    // the same generic lifecycle as engine-owned data.
    this.version(23).stores({
      entityLinks: 'id, projectId, sourceEntityId, targetEntityId, relation, createdAt',
      citations: 'id, projectId, *writingIds, snapshotId, updatedAt',
      publishingProfiles: 'id, projectId, format, updatedAt',
      conversionReceipts: 'id, projectId, sourceEntityId, targetEntityId, createdAt',
    });

    // v24: `yarn-board` and `brainstorm` were the same engine wearing two
    // costumes — an infinite canvas with cards and connecting lines. They are
    // replaced by `board`, which keeps the canvas and makes the connections a
    // real graph: typed relations, many-to-many links, links between links,
    // layers and saved views. All six legacy stores remain present in this
    // version because Dexie applies the schema diff before its upgrader: v24
    // must be able to read them while it copies into the five Board stores.
    this.version(24).stores({
      boards: 'id, projectId',
      boardNodes: 'id, projectId, boardId, kind, *tags',
      boardEdges: 'id, projectId, boardId, sourceId, targetId, kind',
      boardLayers: 'id, projectId, boardId, order',
      boardViews: 'id, projectId, boardId, order',
      yarnBoards: 'id, projectId',
      yarnNodes: 'id, projectId, boardId',
      yarnEdges: 'id, boardId, sourceId, targetId',
      brainstormBoards: 'id, projectId',
      brainstormItems: 'id, boardId, projectId, type',
      brainstormConnections: 'id, boardId, sourceId, targetId',
    }).upgrade(async (tx) => {
      await migrateLegacyBoards(tx);
    });

    // v25: persisted canon supertiles for the world generator — the ~31 s of
    // regional generation paid once per world instead of once per session
    // (PENDIENTE §2b.1). A pure cache in the `worldSnapshots` mould:
    // versioned, byte-budgeted, evicted by `savedAt`, cleared with its world,
    // and deliberately OUTSIDE the backup registry — see
    // `engines/worldgen/canonSnapshots.ts` for the one door to it.
    // v25: retire the source stores only after v24 committed the copy. A
    // database that already crossed the old, destructive v24 has no legacy
    // rows left to recover; later upgrades intentionally create no substitute
    // data. Recovery for those installations requires a pre-v24 backup.
    this.version(25).stores({
      canonTiles: 'id, worldId, savedAt',
      yarnBoards: null,
      yarnNodes: null,
      yarnEdges: null,
      brainstormBoards: null,
      brainstormItems: null,
      brainstormConnections: null,
    });

    // v26: persisted RENDERED tiles for the world generator — the inked
    // 256² product itself, content-addressed, so ground drawn once is ground
    // drawn for ever (tasks/ARQUITECTURA-TESELAS.md §3.2, the renderd rule:
    // the render store IS the product). Same mould as `canonTiles`: a pure
    // cache, byte-budgeted, evicted by `savedAt`, outside the backup
    // registry — see `engines/worldgen/renderedSnapshots.ts` for the door.
    this.version(26).stores({
      renderedTiles: 'id, worldId, savedAt',
    });

    // v27: the in-app copilot's conversations and per-project AI preferences
    // (model route, permission level, remote consent). Project-scoped like
    // every other user table, so deleteProject sweeps them and the
    // `ai-assistant` backup strategy carries them in the ZIP. Keys, model
    // weights and full tool payloads are deliberately NOT here — see
    // services/copilot/types.ts.
    this.version(27).stores({
      aiThreads: 'id, projectId, updatedAt',
      aiMessages: 'id, threadId, projectId, createdAt, role',
      aiProjectSettings: 'projectId, updatedAt',
    });

    // v28: the real atlas — places of the real world the book uses (with
    // coordinates and checked facts) and the deliberate departures from
    // reality. Authoritative rows, unlike the world generator's derived
    // places; see engines/real-atlas/types.ts.
    this.version(28).stores({
      atlasPlaces: 'id, projectId, parentId, kind, name',
      atlasDivergences: 'id, projectId, placeId, category',
    });

    // v29: visual references — the character bible behind the image studio.
    // One row per character, place, object or style the writer wants to look
    // the same twice: the words that describe her, the dialect they are
    // written in, the ids of her reference images, a hero seed, a preset and
    // (once one exists) a trained LoRA. Additive and inert: no existing row is
    // read or rewritten, so a database that has never seen the studio simply
    // gains an empty table.
    //
    // Only IDS of Gallery rows live here, never image bytes — the pictures
    // stay in `inspirationImages`, where Gallery's backup strategy and the AI
    // bridge already know how to find them, and a reference that accumulates
    // twenty-five images stays a few hundred bytes.
    this.version(29).stores({
      visualRefs: 'id, projectId, codexEntryId, kind, updatedAt',
    });

    // v30: image recipes — the record that lets a picture be made again two
    // years later. One row per generation: the written prompt AND the text
    // after wildcards resolved, every sampler parameter, the model and each
    // LoRA identified by SHA-256 rather than by name, the seed and RNG mode,
    // the Gallery ids of any init/mask/control/reference images, and the pass
    // chain. See services/aiRuntime/recipe.ts for the shape and why each part
    // is in it.
    //
    // Additive and inert, exactly like v29: no existing row is read, rewritten
    // or re-keyed, so a database that has never generated an image simply
    // gains an empty table and every Gallery row that predates this keeps
    // whatever provenance it already had in `inspirationImages.generation`.
    //
    // `hash` is indexed because it is the identity of the SETTINGS rather than
    // of the row: it is what "have I already made this exact picture" and
    // "show me every image from this recipe" both ask.
    this.version(30).stores({
      imageRecipes: 'id, projectId, imageId, hash, createdAt',
    });

    // v31: Judge's private reference library and grounded review history.
    // Documents/lenses are personal and global; projects own lightweight links
    // plus their own runs/findings. The original is stored once as a Blob and
    // project deletion therefore cannot erase a source used by another book.
    this.version(31).stores({
      referenceDocuments: 'id, &sha256, status, updatedAt',
      referenceSections: 'id, documentId, order, *terms',
      referenceLenses: 'id, documentId, updatedAt',
      projectReferenceLinks: 'id, projectId, documentId, lensId, status, active',
      judgeRuns: 'id, projectId, writingId, mode, status, createdAt',
      judgeFindings: 'id, projectId, writingId, runId, lensId, mode, status, createdAt',
    });

    // v32: one structural branching kernel shared by Outline and Timeline.
    // Alternatives keep only their deltas; promotion receipts hold the exact
    // inverse so promotion and undo remain atomic without copying prose or a
    // whole project. Additive: existing projects simply start with no branches.
    this.version(32).stores({
      creativeBranches: 'id, projectId, status, updatedAt',
      creativeBranchDeltas: 'id, projectId, branchId, targetKind, targetId, [branchId+targetKind+targetId], updatedAt',
      branchPromotionReceipts: 'id, projectId, branchId, createdAt, undoneAt',
    });

    // v33: the explicit narrative axis and its typed facts, beliefs and world
    // rules. These rows point at canonical entities; they never duplicate a
    // chapter or infer chronology from fictional dates written as prose.
    this.version(33).stores({
      narrativeMoments: 'id, projectId, order, anchorKind, anchorEntityId, &[projectId+anchorKind+anchorEntityId], updatedAt',
      storyClaims: 'id, projectId, kind, status, [projectId+kind], updatedAt',
    });

    // v34: saga-owned identities and project-owned bindings. Full prose and
    // engine records remain in their project; this layer stores only stable
    // identity, a local override and explicit provenance.
    this.version(34).stores({
      sharedCanonEntities: 'id, seriesId, kind, title, updatedAt',
      sharedEntityBindings: 'id, projectId, seriesId, sharedEntityId, &[seriesId+sharedEntityId+projectId], updatedAt',
    });

    // v35: the investigation engine — claims that rest on the research
    // evidence a project already keeps (citations and their excerpts), the
    // competing hypotheses weighed against them, the per-project question, and
    // the log of Wikidata enrichment runs that makes each one undoable.
    // Additive and inert: no existing row is read or rewritten, so a database
    // that has never opened the engine gains five empty tables. Source grading
    // and retraction add OPTIONAL fields to `citations` rows and need no index
    // or upgrade step; `publicFigure` and `wikidataQid` do the same on
    // `codexEntries`. A status is never stored on a claim (it is derived from
    // its sources), so there is nothing here to keep in step.
    this.version(CURRENT_DB_VERSION).stores({
      inquiryCases: 'id, projectId, updatedAt',
      inquiryClaims: 'id, projectId, updatedAt',
      inquiryHypotheses: 'id, projectId, order',
      inquiryRatings: 'id, projectId, hypothesisId, claimId',
      enrichmentRuns: 'id, projectId, entryId, createdAt',
    });
  }
}

export const db = new WritersHoardDB();
