import {MANUSCRIPT_REVIEW_HANDLERS} from '@/engines/writings/manuscriptReview/bridge';
import {PROJECT_GENRE_HANDLERS} from '@/services/projectGenres/bridge';
import {WORLD_FOLDER_IMPORT_HANDLERS} from '@/services/worldFolderImport/bridge';
import {PROJECT_PIN_HANDLERS} from '@/services/projectPin/bridge';
import {PROJECT_DUPLICATE_HANDLERS} from '@/services/projectDuplicate/bridge';
import {WRITING_TOOL_DOCK_HANDLERS} from '@/engines/writings/toolDock/bridge';
import {readLibraryCreationContext} from '@/components/project/workspace/library/createCodex';
import { WORLD_GRAPH_QUERY_HANDLERS } from '@/engines/codex/worldGraph/bridge';
import { VISUAL_SEARCH_HANDLERS } from '@/services/visualSearch/bridge';
import { WIKI_PROFILE_HANDLERS } from '@/services/wikiProfiles/bridge';
import { ENTITY_DETECTION_HANDLERS } from '@/services/entityDetection/bridge';
import { PARALLEL_DRAFT_HANDLERS } from '@/engines/writings/parallelDraftBridge';
import { CODEX_OPTION_LIST_HANDLERS } from '@/engines/codex/optionListBridge';
// ============================================================================
// AI bridge — name → handler table
// ============================================================================
//
// Every entry in BRIDGE_TOOLS (manifest.ts) must have exactly one handler
// here. tests/critical.browser.ts asserts both directions, so a tool added to
// the manifest without a handler fails the release gate instead of failing at
// runtime in front of a model.

import type { ToolArgs } from './shared';
import { DOCUMENT_HANDLERS } from './documents';
import { FICTION_HANDLERS } from './fiction';
import { PUBLISHING_HANDLERS } from './publishing';
import { REVISION_HANDLERS } from './revisions';
import { EDITORIAL_HANDLERS } from './editorialDocument';
import { PROOFING_HANDLERS } from './proofing';
import { MODEL_HANDLERS } from '@/engines/model-viewer/bridge';
import { RADAR_HANDLERS } from '@/engines/radar/bridge';
import { SHEET_HANDLERS } from '@/engines/character-sheets/bridge';
import { whAppendConversationTurn } from './dialog';
import { whStylePlace } from './worldgenStyle';
import { WORLD_ERA_HANDLERS } from '@/services/worldEras/bridge';
import { READER_HANDLERS } from './reader';
import { VOICE_MEMO_HANDLERS } from '@/engines/media/voiceBridge';
import { BOARD_CANVAS_HANDLERS } from '@/engines/board/canvasBridge';
import { WORKSPACE_APPEARANCE_HANDLERS } from '@/services/workspaceAppearance/bridge';
import { LOCAL_TOOL_HANDLERS } from '@/engines/local/bridge';
import { RELATION_TREE_HANDLERS } from '@/engines/genealogy/treeBridge';
import { DOCUMENT_HISTORY_HANDLERS } from '@/services/documentHistory/bridge';
import { MODEL_READER_WIKI_HANDLERS } from './modelReaderWiki';
import { TIMELINE_BATCH_HANDLERS } from '@/engines/timeline/batchBridge';
import { ANNOTATION_THREAD_HANDLERS } from '@/engines/annotations/bridge';
import { DOCUMENT_IMAGE_HANDLERS } from '@/services/documentImage/bridge';
import { TABLE_HANDLERS } from '@/engines/tables/bridge';
import { PUBLISHED_EDITION_HANDLERS } from '@/services/publishedEditions/bridge';
import { DICTIONARY_HANDLERS } from '@/engines/dictionary/bridge';
import { whGetWritingHeadings } from './navigation';
import { db } from '@/db';
import type { GenealogyLinkRow } from '@/engines/genealogy/genealogyStore';
import { createGenealogyBridgeHandlers } from './genealogy';
import { createCodexFolderImporter } from '@/engines/genealogy/codexFolderImport';
import { createCodexFolderImportHandlers } from './codexFolderImport';
import { getEraProject, hideEraDocument, listEraRows, readEraRow, readWorldDocument, saveEraDocument } from '@/services/worldEras/store';
import { effectiveCodexTemplate } from '@/engines/codex/templateHierarchy';
import type { CodexEntry } from '@/types';
import { htmlFromMarkdown, resolveProjectForEngine, resolveProjectId } from './shared';
import { whBuildWorldBible, whExportWorldBible } from './worldBible';
import { whGetEditorialContext, whGetResearchEvidence } from './editorial';
import { whEnableEngine, whGetContext, whListProjects, whSearch } from './context';
import {
  whAppendWriting,
  whCreateWriting,
  whImportStorySession,
  whGetWriting,
  whListWritingVersions,
  whListWritings,
  whRestoreWritingVersion,
  whUpdateWriting,
} from './writings';
import {
  whCodexTemplates, whSaveCodexTemplate, whDeleteCodexTemplate, whPreviewCodexSync, whApplyCodexSync,
  whCreateCodexEntry,
  whGetCodexEntry,
  whListCodex,
  whUpdateCodexEntry,
} from './codex';
import { whCreateDiaryEntry, whListDiary, whUpdateDiaryEntry } from './diary';
import {
  whConnectEvents,
  whCreateEvent,
  whCreateTimeline,
  whListEvents,
  whListTimelines,
  whUpdateEvent,
} from './timeline';
import {
  whChapterReferences,
  whPinReference,
  whReferenceConsult,
  whReferencePreview,
  whReferencePrefs,
  whReferenceSearch,
} from './reference';
import { whWorldCalendarGet, whWorldCalendarSet, whWorldDate } from './worldCalendar';

import { whCreateNote, whListNotes, whUpdateNote } from './notes';
import {
  whCreateBeat,
  whCreateOutline,
  whListBeats,
  whListOutlines,
  whUpdateBeat,
} from './outline';
import {
  whDownloadSnapshotMedia,
  whGetSnapshot,
  whImportSnapshots,
  whListInstagramCollection,
  whListSnapshots,
  whTagSnapshot,
  whViewSnapshotImage,
} from './scrapper';

import {
  whAddDialog,
  whCreateScene,
  whGetScene,
  whListScenes,
  whUpdateDialogBlock,
  whUpdateScene,
} from './dialog';
import { whAddArcBeat, whCreateArc, whGetArc, whListArcs, whUpdateArcBeat } from './arcs';
import {
  whCreateRelationship,
  whListRelationships,
  whUpdateRelationship,
} from './relationships';
import { whAddPayoff, whCreateSeed, whListSeeds, whUpdateSeed } from './seeds';
import {
  whAddBiographyFact,
  whCreateBiography,
  whGetBiography,
  whListBiographies,
  whUpdateBiographyFact,
} from './biography';
import {
  whAddBoardCard,
  whConnectBoardCards,
  whCreateBoard,
  whGetBoard,
  whListBoards,
  whUpdateBoardCard,
  whViewBoardImage,
} from './board';
import { whListImages, whTagImage, whViewImage } from './gallery';
import { whGenerateImage } from './imageStudio';
import { whAddMapFeature, whAddMapPin, whCaptureMapVersion, whChangeMapGround, whLinkMapVersion, whListMapFeatures, whListMaps, whListMapVersions, whMeasureMap, whNameMapPinsFromKey, whPreviewMapGround, whSetMapScale, whUpdateMapFeature, whUpdateMapPin } from './maps';
import {
  whAddLabel,
  whListLabels,
  whAddStamp,
  whPaintReaderFog,
  whReaderView,
  whAddStoryEvent,
  whUpdateStoryEvent,
  whRemoveStoryEvent,
  whListStoryEvents,
  whStoryChapters,
  whAddSpringRiver,
  whAddWorldRoad,
  whAddLake,
  whDrainLake,
  whLockPlace,
  whDuplicatePlace,
  whWorldEconomy,
  whListTradeSites,
  whAddTradeSite,
  whRemoveTradeSite,
  whRestoreTradeSite,
  whListStamps,
  whUpdateLabel,
  whAddPlace,
  whAddWaypoint,
  whFindPlace,
  whGetWorld,
  whRenderWorldMap,
  whGetWorldPresentation,
  whSetWorldPresentation,
  whCreateWorld,
  whMeasureWorld,
  whGetWorldTravelSettings,
  whSetWorldTravelSettings,
  whPlanJourney,
  whLinkPlace,
  whListPlaceLinks,
  whListPlaces,
  whListWaypoints,
  whListWorlds,
  whMovePlace,
  whPlaceAt,
  whRemovePlace,
  whRenamePlace,
  whRestorePlace,
  whUpdateWaypoint,
  whWorldSummary,
} from './worldgen';
import {
  whAtlasDistance,
  whAtlasPlacesNear,
  whCreateAtlasPlace,
  whCreateAtlasRoute,
  whCreateDivergence,
  whGetAtlasPlace,
  whGetDivergence,
  whListAtlasPlaces,
  whListAtlasRoutes,
  whListDivergences,
  whRealityCheck,
  whUpdateAtlasPlace,
  whUpdateDivergence,
} from './realAtlas';
import {
  whAddStoryboardPanel,
  whCreateStoryboard,
  whListStoryboards,
  whUpdateStoryboardPanel,
} from './storyboard';
import {
  whAddVideoSegment,
  whCreateVideoPlan,
  whListVideoPlans,
  whUpdateVideoSegment,
} from './video';
import { whAnnotate, whListAnnotations } from './annotations';
import { whPovAudit, whWritingStats } from './analysis';
import {
  whGetManuscriptBoard,
  whGetNarrativeCoverage,
  whListPhraseRecurrence,
  whListTimelineEvidence,
  whSetCoverageCell,
  whSetTimelineEvidence,
} from './narrativeCoverage';
import { whDelete } from './deletion';
import {
  whAchMatrix,
  whAddClaim,
  whAddHypothesis,
  whEnrichCodex,
  whGradeSource, whBibliography,
  whInquiryReport,
  whInquiryTimeline,
  whListClaims,
  whRateHypothesis,
  whRetractSource,
  whSearchLibrary,
  whUndoEnrichment,
  whUpdateClaim,
} from './inquiry';
import {
  whGetJudgeEvidence,
  whGetJudgeReview,
  whListJudgeLenses,
  whListJudgeReviews,
  whRunJudge,
} from './judge';

import {
  whBetaCommentSetStatus, whBetaComments, whBetaImport, whBetaPackageCreate,
} from './betaReading';
import {
  whCharacterToProspero,
  whStoryboardToProspero,
  whWorldFromScheherazade,
  whWorldToScheherazade,
} from './family';

export type ToolHandler = (args: ToolArgs) => Promise<unknown>;

// Genealogy contract tools (§5): the factory takes the live table and a
// character loader (codex entries of type 'character', keyed by title).
const genealogyHandlers = createGenealogyBridgeHandlers(
  {
    where: (key) => db.genealogyLinks.where(key),
    bulkPut: (rows) => db.genealogyLinks.bulkPut(rows as GenealogyLinkRow[]),
    get: (id) => db.genealogyLinks.get(id),
    delete: (id) => db.genealogyLinks.delete(id),
  },
  async (projectId) =>
    (await db.codexEntries.where('projectId').equals(projectId).toArray())
      .filter((entry) => entry.type === 'character')
      .map((entry) => ({ id: entry.id, name: entry.title })),
);

// The domain factory stays independent of app state. Its bridge writes use
// the same existing project visibility precondition as the other engines.
for (const name of ['wh_genealogy_apply', 'wh_genealogy_undo'] as const) {
  const handler = genealogyHandlers[name];
  genealogyHandlers[name] = async args => {
    await resolveProjectForEngine(args, 'genealogy');
    return handler(args);
  };
}

const codexFolderImporters = new Map<string, ReturnType<typeof createCodexFolderImporter>>();
const codexFolderHandlers = createCodexFolderImportHandlers(args => {
  const scope = { projectId: resolveProjectId(args), eraId: typeof args.eraId === 'string' ? args.eraId : undefined }, key = JSON.stringify([scope.projectId, scope.eraId]);
  let importer = codexFolderImporters.get(key);
  if (!importer) {
    importer = createCodexFolderImporter({
      templates: async () => { const templates = (await getEraProject(scope)).codexTemplates ?? []; return templates.map(template => effectiveCodexTemplate(template, templates)); },
      list: projectId => scope.eraId ? listEraRows<CodexEntry>(scope, 'codexEntries') : db.codexEntries.where('projectId').equals(projectId).toArray(),
      get: id => scope.eraId ? readEraRow<CodexEntry>(scope, 'codexEntries', id) : db.codexEntries.get(id),
      addAll: async rows => { if (!scope.eraId) return db.codexEntries.bulkAdd(rows); for (const row of rows) await saveEraDocument(scope, 'codex', { root: { ...row }, children: {} }, null); },
      deleteAll: async ids => { if (!scope.eraId) return db.codexEntries.bulkDelete(ids); for (const id of ids) { const current = await readWorldDocument(scope, 'codex', id); if (current) await hideEraDocument(scope, 'codex', id, current.version); } },
      atomic: run => db.transaction('rw', db.tables, run),
    }, htmlFromMarkdown);
    codexFolderImporters.set(key, importer);
  }
  return importer;
}, async (args, writes) => writes ? resolveProjectForEngine(args, 'codex') : resolveProjectId(args));

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  wh_append_conversation_turn: whAppendConversationTurn,
  ...MODEL_HANDLERS,
  ...RADAR_HANDLERS,
  ...SHEET_HANDLERS,
  ...WORLD_ERA_HANDLERS,
  ...READER_HANDLERS,
  ...VOICE_MEMO_HANDLERS,
  ...BOARD_CANVAS_HANDLERS,
  ...WORKSPACE_APPEARANCE_HANDLERS,
  ...LOCAL_TOOL_HANDLERS,
  ...RELATION_TREE_HANDLERS,
  ...DOCUMENT_HISTORY_HANDLERS,
  ...MODEL_READER_WIKI_HANDLERS,
  ...TIMELINE_BATCH_HANDLERS,
  ...ANNOTATION_THREAD_HANDLERS,
  ...DOCUMENT_IMAGE_HANDLERS,
  ...TABLE_HANDLERS,
  ...PUBLISHED_EDITION_HANDLERS,
  ...DICTIONARY_HANDLERS,
  ...CODEX_OPTION_LIST_HANDLERS,
  ...VISUAL_SEARCH_HANDLERS,
  ...WIKI_PROFILE_HANDLERS,
  ...MANUSCRIPT_REVIEW_HANDLERS,
  ...PROJECT_GENRE_HANDLERS,
  ...WORLD_FOLDER_IMPORT_HANDLERS,
  ...PROJECT_PIN_HANDLERS,
  ...PROJECT_DUPLICATE_HANDLERS,
  ...WRITING_TOOL_DOCK_HANDLERS,
  ...WORLD_GRAPH_QUERY_HANDLERS,
  ...ENTITY_DETECTION_HANDLERS,
  ...PARALLEL_DRAFT_HANDLERS,
  ...FICTION_HANDLERS,
  ...PUBLISHING_HANDLERS,
  ...DOCUMENT_HANDLERS,
  ...REVISION_HANDLERS,
  ...EDITORIAL_HANDLERS,
  ...PROOFING_HANDLERS,
  wh_get_writing_headings: whGetWritingHeadings,
  ...codexFolderHandlers,
  ...genealogyHandlers,
  wh_build_world_bible: whBuildWorldBible,
  wh_export_world_bible: whExportWorldBible,
  wh_get_research_evidence: whGetResearchEvidence,
  wh_get_editorial_context: whGetEditorialContext,
  // Orientation
  wh_get_context: whGetContext,
  wh_workspace_library_get: args=>readLibraryCreationContext({projectId:resolveProjectId(args),eraId:typeof args.eraId==='string'?args.eraId:undefined}),
  wh_list_projects: whListProjects,
  wh_enable_engine: whEnableEngine,
  wh_search: whSearch,
  wh_delete: whDelete,
  // Manuscript
  wh_list_writings: whListWritings,
  wh_get_writing: whGetWriting,
  wh_create_writing: whCreateWriting,
  wh_import_story_session: whImportStorySession,
  wh_update_writing: whUpdateWriting,
  wh_append_writing: whAppendWriting,
  wh_list_writing_versions: whListWritingVersions,
  wh_restore_writing_version: whRestoreWritingVersion,
  wh_list_judge_lenses: whListJudgeLenses,
  wh_get_judge_evidence: whGetJudgeEvidence,
  wh_run_judge: whRunJudge,
  wh_get_judge_review: whGetJudgeReview,
  wh_list_judge_reviews: whListJudgeReviews,
  // Codex
  wh_list_codex: whListCodex,
  wh_get_codex_entry: whGetCodexEntry,
  wh_codex_templates: whCodexTemplates,
  wh_save_codex_template: whSaveCodexTemplate,
  wh_delete_codex_template: whDeleteCodexTemplate,
  wh_preview_codex_sync: whPreviewCodexSync,
  wh_apply_codex_sync: whApplyCodexSync,
  wh_create_codex_entry: whCreateCodexEntry,
  wh_update_codex_entry: whUpdateCodexEntry,
  // Diary
  wh_list_diary: whListDiary,
  wh_create_diary_entry: whCreateDiaryEntry,
  wh_update_diary_entry: whUpdateDiaryEntry,
  // Timeline
  wh_list_timelines: whListTimelines,
  wh_create_timeline: whCreateTimeline,
  wh_list_events: whListEvents,
  wh_create_event: whCreateEvent,
  wh_world_calendar_get: whWorldCalendarGet,
  wh_world_calendar_set: whWorldCalendarSet,
  wh_world_date: whWorldDate,
  wh_chapter_references: whChapterReferences,
  wh_pin_reference: whPinReference,
  wh_reference_consult: whReferenceConsult,
  wh_reference_prefs: whReferencePrefs,
  wh_reference_search: whReferenceSearch,
  wh_reference_preview: whReferencePreview,
  wh_update_event: whUpdateEvent,
  wh_connect_events: whConnectEvents,
  // Outline
  wh_list_outlines: whListOutlines,
  wh_create_outline: whCreateOutline,
  wh_list_beats: whListBeats,
  wh_create_beat: whCreateBeat,
  wh_update_beat: whUpdateBeat,
  // Notes
  wh_list_notes: whListNotes,
  wh_create_note: whCreateNote,
  wh_update_note: whUpdateNote,
  // Clippings and the vision loop
  wh_list_snapshots: whListSnapshots,
  wh_get_snapshot: whGetSnapshot,
  wh_view_snapshot_image: whViewSnapshotImage,
  wh_tag_snapshot: whTagSnapshot,
  wh_list_instagram_collection: whListInstagramCollection,
  wh_import_snapshots: whImportSnapshots,
  wh_download_snapshot_media: whDownloadSnapshotMedia,
  // Dialog scenes
  wh_list_scenes: whListScenes,
  wh_get_scene: whGetScene,
  wh_create_scene: whCreateScene,
  wh_update_scene: whUpdateScene,
  wh_add_dialog: whAddDialog,
  wh_update_dialog_block: whUpdateDialogBlock,
  // Character arcs
  wh_list_arcs: whListArcs,
  wh_get_arc: whGetArc,
  wh_create_arc: whCreateArc,
  wh_add_arc_beat: whAddArcBeat,
  wh_update_arc_beat: whUpdateArcBeat,
  // Relationships
  wh_list_relationships: whListRelationships,
  wh_create_relationship: whCreateRelationship,
  wh_update_relationship: whUpdateRelationship,
  // Seeds and payoffs
  wh_list_seeds: whListSeeds,
  wh_create_seed: whCreateSeed,
  wh_update_seed: whUpdateSeed,
  wh_add_payoff: whAddPayoff,
  // Biography
  wh_list_biographies: whListBiographies,
  wh_get_biography: whGetBiography,
  wh_create_biography: whCreateBiography,
  wh_add_biography_fact: whAddBiographyFact,
  wh_update_biography_fact: whUpdateBiographyFact,
  // Board
  wh_list_boards: whListBoards,
  wh_create_board: whCreateBoard,
  wh_get_board: whGetBoard,
  wh_add_board_card: whAddBoardCard,
  wh_update_board_card: whUpdateBoardCard,
  wh_connect_board_cards: whConnectBoardCards,
  wh_view_board_image: whViewBoardImage,
  // Gallery
  wh_list_images: whListImages,
  wh_view_image: whViewImage,
  wh_tag_image: whTagImage,
  // Image studio
  wh_generate_image: whGenerateImage,
  // Maps
  wh_list_maps: whListMaps,
  wh_add_map_pin: whAddMapPin,
  wh_update_map_pin: whUpdateMapPin,
  wh_list_map_versions: whListMapVersions,
  wh_capture_map_version: whCaptureMapVersion,
  wh_link_map_version: whLinkMapVersion,
  // World generator
  wh_list_worlds: whListWorlds,
  wh_get_world: whGetWorld,
  wh_render_world_map: whRenderWorldMap,
  wh_get_world_presentation: whGetWorldPresentation,
  wh_set_world_presentation: whSetWorldPresentation,
  wh_create_world: whCreateWorld,
  wh_measure_world: whMeasureWorld,
  wh_get_world_travel_settings: whGetWorldTravelSettings,
  wh_set_world_travel_settings: whSetWorldTravelSettings,
  wh_plan_journey: whPlanJourney,
  wh_style_place: whStylePlace,
  wh_list_places: whListPlaces,
  wh_find_place: whFindPlace,
  wh_place_at: whPlaceAt,
  wh_world_summary: whWorldSummary,
  wh_add_place: whAddPlace,
  wh_rename_place: whRenamePlace,
  wh_move_place: whMovePlace,
  wh_remove_place: whRemovePlace,
  wh_restore_place: whRestorePlace,
  wh_add_label: whAddLabel,
  wh_list_labels: whListLabels,
  wh_add_stamp: whAddStamp,
  wh_paint_reader_fog: whPaintReaderFog,
  wh_reader_view: whReaderView,
  wh_add_story_event: whAddStoryEvent,
  wh_update_story_event: whUpdateStoryEvent,
  wh_remove_story_event: whRemoveStoryEvent,
  wh_list_story_events: whListStoryEvents,
  wh_story_chapters: whStoryChapters,
  wh_add_spring_river: whAddSpringRiver,
  wh_add_world_road: whAddWorldRoad,
  wh_add_lake: whAddLake,
  wh_drain_lake: whDrainLake,
  wh_lock_place: whLockPlace,
  wh_duplicate_place: whDuplicatePlace,
  wh_world_economy: whWorldEconomy,
  wh_list_trade_sites: whListTradeSites,
  wh_add_trade_site: whAddTradeSite,
  wh_list_map_features: whListMapFeatures,
  wh_add_map_feature: whAddMapFeature,
  wh_update_map_feature: whUpdateMapFeature,
  wh_change_map_ground: whChangeMapGround,
  wh_preview_map_ground: whPreviewMapGround,
  wh_set_map_scale: whSetMapScale,
  wh_measure_map: whMeasureMap,
  wh_name_map_pins_from_key: whNameMapPinsFromKey,
  wh_remove_trade_site: whRemoveTradeSite,
  wh_restore_trade_site: whRestoreTradeSite,
  wh_list_stamps: whListStamps,
  wh_update_label: whUpdateLabel,
  wh_list_waypoints: whListWaypoints,
  wh_add_waypoint: whAddWaypoint,
  wh_update_waypoint: whUpdateWaypoint,
  wh_link_place: whLinkPlace,
  wh_list_place_links: whListPlaceLinks,
  // Real atlas
  wh_list_atlas_places: whListAtlasPlaces,
  wh_get_atlas_place: whGetAtlasPlace,
  wh_create_atlas_place: whCreateAtlasPlace,
  wh_update_atlas_place: whUpdateAtlasPlace,
  wh_list_divergences: whListDivergences,
  wh_get_divergence: whGetDivergence,
  wh_create_divergence: whCreateDivergence,
  wh_update_divergence: whUpdateDivergence,
  wh_atlas_distance: whAtlasDistance,
  wh_atlas_places_near: whAtlasPlacesNear,
  wh_list_atlas_routes: whListAtlasRoutes,
  wh_create_atlas_route: whCreateAtlasRoute,
  wh_reality_check: whRealityCheck,
  // Storyboard
  wh_list_storyboards: whListStoryboards,
  wh_create_storyboard: whCreateStoryboard,
  wh_add_storyboard_panel: whAddStoryboardPanel,
  wh_update_storyboard_panel: whUpdateStoryboardPanel,
  // Video planner
  wh_list_video_plans: whListVideoPlans,
  wh_create_video_plan: whCreateVideoPlan,
  wh_add_video_segment: whAddVideoSegment,
  wh_update_video_segment: whUpdateVideoSegment,
  // Source grading and the Investigation
  wh_grade_source: whGradeSource,
  wh_retract_source: whRetractSource,
  wh_bibliography: whBibliography,
  wh_list_claims: whListClaims,
  wh_add_claim: whAddClaim,
  wh_update_claim: whUpdateClaim,
  wh_inquiry_timeline: whInquiryTimeline,
  wh_add_hypothesis: whAddHypothesis,
  wh_rate_hypothesis: whRateHypothesis,
  wh_ach_matrix: whAchMatrix,
  wh_enrich_codex: whEnrichCodex,
  wh_undo_enrichment: whUndoEnrichment,
  wh_inquiry_report: whInquiryReport,
  wh_search_library: whSearchLibrary,
  // Hand-offs to the other Hoard apps
  wh_character_to_prospero: whCharacterToProspero,
  wh_storyboard_to_prospero: whStoryboardToProspero,
  wh_world_to_scheherazade: whWorldToScheherazade,
  wh_world_from_scheherazade: whWorldFromScheherazade,
  // Beta reading
  wh_beta_package_create: whBetaPackageCreate,
  wh_beta_import: whBetaImport,
  wh_beta_comments: whBetaComments,
  wh_beta_comment_set_status: whBetaCommentSetStatus,
  // Annotations and analysis
  wh_list_annotations: whListAnnotations,
  wh_annotate: whAnnotate,
  wh_pov_audit: whPovAudit,
  wh_writing_stats: whWritingStats,
  wh_get_narrative_coverage: whGetNarrativeCoverage,
  wh_set_coverage_cell: whSetCoverageCell,
  wh_list_timeline_evidence: whListTimelineEvidence,
  wh_set_timeline_evidence: whSetTimelineEvidence,
  wh_get_manuscript_board: whGetManuscriptBoard,
  wh_list_phrase_recurrence: whListPhraseRecurrence,
};

/**
 * Diagnostics the bridge can run but no model can call: they are deliberately
 * absent from the manifest, so they never reach a tool list. Reached through
 * their own HTTP routes.
 */
export const INTERNAL_HANDLERS: Record<string, ToolHandler> = {
  __selftest: async (args) => {
    // Imported lazily so the self-test suite is not part of the chunk the
    // bridge loads to serve ordinary tool calls.
    const { runSelfTest } = await import('../selftest');
    return runSelfTest(args);
  },
  __selftest_cleanup: async (args) => {
    const { cleanupSelfTestProjects } = await import('../selftest');
    return cleanupSelfTestProjects(args);
  },
  __undo: async (args) => {
    const { undoAuditEntry } = await import('../undo');
    return undoAuditEntry(args);
  },
};
