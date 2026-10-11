"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.WritersHoardDB = exports.CURRENT_DB_VERSION = void 0;
var dexie_1 = require("dexie");
var legacyLinks_1 = require("@/engines/scrapper/legacyLinks");
var legacyBoardMigration_1 = require("./legacyBoardMigration");
/** Single source of truth for migration and compatibility tests. */
exports.CURRENT_DB_VERSION = 36;
var WritersHoardDB = /** @class */ (function (_super) {
    __extends(WritersHoardDB, _super);
    function WritersHoardDB() {
        var _this = _super.call(this, 'WritersHoardDB') || this;
        _this.version(2).stores({
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
        _this.version(3).stores({
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
        _this.version(4).stores({
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
        }).upgrade(function (tx) {
            // Migrate linkedEntryId -> linkedEntryIds
            return tx.table('inspirationImages').toCollection().modify(function (img) {
                if (img.linkedEntryId && !img.linkedEntryIds) {
                    img.linkedEntryIds = [img.linkedEntryId];
                }
                if (!img.linkedEntryIds) {
                    img.linkedEntryIds = [];
                }
            });
        });
        _this.version(5).stores({
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
        _this.version(6).stores({
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
        _this.version(7).stores({
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
        _this.version(8).stores({
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
        _this.version(9).stores({
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
        }).upgrade(function (tx) {
            var defaultEngines = ['writings', 'codex', 'timeline', 'yarn-board', 'maps', 'gallery', 'links'];
            return tx.table('projects').toCollection().modify(function (project) {
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
        _this.version(10).stores({
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
        }).upgrade(function (tx) {
            return tx.table('timelineEvents').toCollection().modify(function (evt) {
                if (!evt.dateMode) {
                    evt.dateMode = 'text';
                }
            });
        });
        // v11: Add diary entries table
        _this.version(11).stores({
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
        _this.version(12).stores({
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
        _this.version(13).stores({
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
        _this.version(14).stores({
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
        _this.version(15).stores({
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
        }).upgrade(function (tx) {
            // Backfill existing timeline events with eventType
            tx.table('timelineEvents').toCollection().modify(function (evt) {
                if (!evt.eventType) {
                    // If event has an end date, it's a range; otherwise a point
                    evt.eventType = evt.realDateEnd ? 'range' : 'point';
                }
            });
            // Backfill existing timelines with color
            tx.table('timelines').toCollection().modify(function (tl) {
                if (!tl.color) {
                    tl.color = '#c4973b'; // default gold
                }
            });
        });
        // v16: Character Arcs, Relationship Matrix, Seeds & Payoffs
        _this.version(16).stores({
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
        _this.version(17).stores({
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
        _this.version(18).stores({
            writingSnapshots: 'id, writingId, projectId, createdAt',
        });
        // v19: World Generator — worlds stored as seed+params (deterministic
        // regeneration), waypoints as plain rows. Additive tables only.
        _this.version(19).stores({
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
        _this.version(20).stores({
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
        _this.version(21).stores({
            notes: 'id, projectId, kind, *tags, pinned, createdAt',
        }).upgrade(function (tx) { return __awaiter(_this, void 0, void 0, function () {
            var links, snapshots, projectIdsWithLinks, rewrite;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, tx.table('externalLinks').toArray()];
                    case 1:
                        links = _a.sent();
                        snapshots = (0, legacyLinks_1.legacyLinksToSnapshots)(links);
                        if (!links.length) return [3 /*break*/, 3];
                        if (!snapshots.length) return [3 /*break*/, 3];
                        return [4 /*yield*/, tx.table('snapshots').bulkPut(snapshots)];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        projectIdsWithLinks = new Set(snapshots.map(function (snapshot) { return snapshot.projectId; }));
                        rewrite = function (list, enableScrapper) {
                            if (!Array.isArray(list))
                                return undefined;
                            var next = list.filter(function (e) { return e !== 'links'; });
                            if (enableScrapper && !next.includes('scrapper'))
                                next.push('scrapper');
                            if (!next.includes('notes'))
                                next.push('notes');
                            return next;
                        };
                        return [4 /*yield*/, tx.table('projects').toCollection().modify(function (project) {
                                var enableScrapper = projectIdsWithLinks.has(project.id);
                                var enabled = rewrite(project.enabledEngines, enableScrapper);
                                if (enabled)
                                    project.enabledEngines = enabled;
                                var order = rewrite(project.engineOrder, enableScrapper);
                                if (order)
                                    project.engineOrder = order;
                            })];
                    case 4:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        }); });
        // v22: drop the now-empty `externalLinks` store. Separate version on
        // purpose — Dexie applies each version's schema diff before running that
        // version's upgrader, so v21 still sees the table it needs to read.
        _this.version(22).stores({
            externalLinks: null,
        });
        // v23: cross-engine project tools. These tables are intentionally
        // project-scoped so deletion and transactional restore cover them through
        // the same generic lifecycle as engine-owned data.
        _this.version(23).stores({
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
        _this.version(24).stores({
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
        }).upgrade(function (tx) { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, (0, legacyBoardMigration_1.migrateLegacyBoards)(tx)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        }); });
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
        _this.version(25).stores({
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
        _this.version(26).stores({
            renderedTiles: 'id, worldId, savedAt',
        });
        // v27: the in-app copilot's conversations and per-project AI preferences
        // (model route, permission level, remote consent). Project-scoped like
        // every other user table, so deleteProject sweeps them and the
        // `ai-assistant` backup strategy carries them in the ZIP. Keys, model
        // weights and full tool payloads are deliberately NOT here — see
        // services/copilot/types.ts.
        _this.version(27).stores({
            aiThreads: 'id, projectId, updatedAt',
            aiMessages: 'id, threadId, projectId, createdAt, role',
            aiProjectSettings: 'projectId, updatedAt',
        });
        // v28: the real atlas — places of the real world the book uses (with
        // coordinates and checked facts) and the deliberate departures from
        // reality. Authoritative rows, unlike the world generator's derived
        // places; see engines/real-atlas/types.ts.
        _this.version(28).stores({
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
        _this.version(29).stores({
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
        _this.version(30).stores({
            imageRecipes: 'id, projectId, imageId, hash, createdAt',
        });
        // v31: Judge's private reference library and grounded review history.
        // Documents/lenses are personal and global; projects own lightweight links
        // plus their own runs/findings. The original is stored once as a Blob and
        // project deletion therefore cannot erase a source used by another book.
        _this.version(31).stores({
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
        _this.version(32).stores({
            creativeBranches: 'id, projectId, status, updatedAt',
            creativeBranchDeltas: 'id, projectId, branchId, targetKind, targetId, [branchId+targetKind+targetId], updatedAt',
            branchPromotionReceipts: 'id, projectId, branchId, createdAt, undoneAt',
        });
        // v33: the explicit narrative axis and its typed facts, beliefs and world
        // rules. These rows point at canonical entities; they never duplicate a
        // chapter or infer chronology from fictional dates written as prose.
        _this.version(33).stores({
            narrativeMoments: 'id, projectId, order, anchorKind, anchorEntityId, &[projectId+anchorKind+anchorEntityId], updatedAt',
            storyClaims: 'id, projectId, kind, status, [projectId+kind], updatedAt',
        });
        // v34: saga-owned identities and project-owned bindings. Full prose and
        // engine records remain in their project; this layer stores only stable
        // identity, a local override and explicit provenance.
        _this.version(34).stores({
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
        _this.version(35).stores({
            inquiryCases: 'id, projectId, updatedAt',
            inquiryClaims: 'id, projectId, updatedAt',
            inquiryHypotheses: 'id, projectId, order',
            inquiryRatings: 'id, projectId, hypothesisId, claimId',
            enrichmentRuns: 'id, projectId, entryId, createdAt',
        });
        // v36: the genealogy engine's links, one row per directed relationship
        // between two characters of a project (kinds: biological_parent,
        // adoptive_parent, guardian, partner). Additive and inert: the table is
        // empty until the genealogy engine writes to it, so no existing row is
        // read or rewritten and no upgrade step is needed. The row shape and its
        // storage validation live in engines/genealogy/genealogyStore.ts; the
        // characters themselves stay in their own table.
        _this.version(exports.CURRENT_DB_VERSION).stores({
            genealogyLinks: 'id, projectId, from, to, kind, [projectId+from], [projectId+to], updatedAt',
        });
        return _this;
    }
    return WritersHoardDB;
}(dexie_1.default));
exports.WritersHoardDB = WritersHoardDB;
exports.db = new WritersHoardDB();
