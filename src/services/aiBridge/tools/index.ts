// ============================================================================
// AI bridge — name → handler table
// ============================================================================
//
// Every entry in BRIDGE_TOOLS (manifest.ts) must have exactly one handler
// here. tests/critical.browser.ts asserts both directions, so a tool added to
// the manifest without a handler fails the release gate instead of failing at
// runtime in front of a model.

import type { ToolArgs } from './shared';
import { whEnableEngine, whGetContext, whListProjects, whSearch } from './context';
import {
  whAppendWriting,
  whCreateWriting,
  whGetWriting,
  whListWritingVersions,
  whListWritings,
  whRestoreWritingVersion,
  whUpdateWriting,
} from './writings';
import {
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
import { whAddMapPin, whListMaps, whUpdateMapPin } from './maps';
import {
  whAddLabel,
  whAddPlace,
  whAddWaypoint,
  whFindPlace,
  whGetWorld,
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
import { whDelete } from './deletion';

export type ToolHandler = (args: ToolArgs) => Promise<unknown>;

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  // Orientation
  wh_get_context: whGetContext,
  wh_list_projects: whListProjects,
  wh_enable_engine: whEnableEngine,
  wh_search: whSearch,
  wh_delete: whDelete,
  // Manuscript
  wh_list_writings: whListWritings,
  wh_get_writing: whGetWriting,
  wh_create_writing: whCreateWriting,
  wh_update_writing: whUpdateWriting,
  wh_append_writing: whAppendWriting,
  wh_list_writing_versions: whListWritingVersions,
  wh_restore_writing_version: whRestoreWritingVersion,
  // Codex
  wh_list_codex: whListCodex,
  wh_get_codex_entry: whGetCodexEntry,
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
  // World generator
  wh_list_worlds: whListWorlds,
  wh_get_world: whGetWorld,
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
  // Annotations and analysis
  wh_list_annotations: whListAnnotations,
  wh_annotate: whAnnotate,
  wh_pov_audit: whPovAudit,
  wh_writing_stats: whWritingStats,
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
