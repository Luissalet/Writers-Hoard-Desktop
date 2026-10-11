"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateLegacyBoards = migrateLegacyBoards;
var catalog_1 = require("@/engines/board/catalog");
var htmlToText_1 = require("@/engines/_shared/anchoring/htmlToText");
var LEGACY_NOTE_COLORS = {
    yellow: '#fef3c7',
    pink: '#fce7f3',
    blue: '#dbeafe',
    green: '#d1fae5',
    purple: '#ede9fe',
};
var ENTITY_TYPE_ENGINES = {
    codex: 'codex',
    'codex-entry': 'codex',
    character: 'codex',
    location: 'codex',
    timeline: 'timeline',
    'timeline-event': 'timeline',
    snapshot: 'scrapper',
    scrapper: 'scrapper',
    scene: 'dialog-scene',
    'dialog-block': 'dialog-scene',
    'dialog-scene': 'dialog-scene',
    writing: 'writings',
    writings: 'writings',
    image: 'gallery',
    gallery: 'gallery',
    note: 'notes',
    notes: 'notes',
    storyboard: 'storyboard',
    panel: 'storyboard',
    biography: 'biography',
    'biography-fact': 'biography',
    outline: 'outline',
    'outline-beat': 'outline',
    'character-arc': 'character-arc',
    'arc-beat': 'character-arc',
    relationship: 'relationships',
    seed: 'seeds',
    payoff: 'seeds',
    diary: 'diary',
    'diary-entry': 'diary',
    maps: 'maps',
    'map-pin': 'maps',
    'video-planner': 'video-planner',
    'video-segment': 'video-planner',
    'writing-stats': 'writing-stats',
    'writing-session': 'writing-stats',
};
/**
 * Allocate destination IDs without changing any ID that is unique across the
 * two source tables. Yarn wins a true cross-engine collision; the Brainstorm
 * row receives a deterministic, reserved-prefix ID and all of its references
 * are rewritten through the returned map.
 */
function allocateIds(yarnIds, brainstormIds, entity) {
    var yarn = new Map();
    var brainstorm = new Map();
    var originals = new Set(__spreadArray(__spreadArray([], yarnIds, true), brainstormIds, true));
    var used = new Set();
    for (var _i = 0, _a = __spreadArray([], yarnIds, true).sort(); _i < _a.length; _i++) {
        var id = _a[_i];
        yarn.set(id, id);
        used.add(id);
    }
    for (var _b = 0, _c = __spreadArray([], brainstormIds, true).sort(); _b < _c.length; _b++) {
        var id = _c[_b];
        if (!used.has(id)) {
            brainstorm.set(id, id);
            used.add(id);
            continue;
        }
        var base = "legacy:brainstorm:".concat(entity, ":").concat(id);
        var candidate = base;
        var suffix = 2;
        while (used.has(candidate) || originals.has(candidate)) {
            candidate = "".concat(base, ":").concat(suffix);
            suffix += 1;
        }
        brainstorm.set(id, candidate);
        used.add(candidate);
    }
    return [yarn, brainstorm];
}
function mapped(map, id, context) {
    var result = map.get(id);
    if (result === undefined) {
        throw new Error("Cannot migrate ".concat(context, ": missing legacy target \"").concat(id, "\"."));
    }
    return result;
}
function yarnNodeKind(type) {
    switch (type) {
        case 'character':
        case 'event':
        case 'concept':
        case 'note':
            return 'card';
        case 'group':
            return 'frame';
        default:
            return type;
    }
}
function brainstormNodeKind(type) {
    switch (type) {
        case 'note': return 'postit';
        case 'image': return 'image';
        case 'entity-ref': return 'entity';
        case 'text-block': return 'text';
        case 'section': return 'frame';
    }
}
function nodeSize(kind, width, height) {
    return {
        width: width !== null && width !== void 0 ? width : catalog_1.DEFAULT_SIZE[kind].width,
        height: height !== null && height !== void 0 ? height : catalog_1.DEFAULT_SIZE[kind].height,
    };
}
function parsePreview(value) {
    if (!value)
        return {};
    try {
        var parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return {};
        var row = parsed;
        return {
            title: typeof row.title === 'string' ? row.title : undefined,
            subtitle: typeof row.subtitle === 'string' ? row.subtitle : undefined,
            thumbnail: typeof row.thumbnail === 'string' ? row.thumbnail : undefined,
            color: typeof row.color === 'string' ? row.color : undefined,
        };
    }
    catch (_a) {
        return {};
    }
}
function remapLegacyEntity(engineId, entityType, entityId, maps) {
    if (engineId === 'yarn-board' || entityType === 'yarn-board' || entityType === 'yarn-node') {
        if (entityType === 'yarn-board') {
            var next = maps.yarnBoards.get(entityId);
            return {
                engineId: 'board',
                entityType: 'board',
                entityId: next !== null && next !== void 0 ? next : entityId,
                missing: next === undefined,
            };
        }
        if (entityType === 'yarn-node') {
            var next = maps.yarnNodes.get(entityId);
            return {
                engineId: 'board',
                entityType: 'board-node',
                entityId: next !== null && next !== void 0 ? next : entityId,
                missing: next === undefined,
            };
        }
        // The annotation/receipt contracts carry no entity type. Match the old
        // Yarn resolver's node-first lookup, then fall back to a board.
        var nodeId = maps.yarnNodes.get(entityId);
        if (nodeId !== undefined)
            return { engineId: 'board', entityType: entityType, entityId: nodeId };
        var boardId = maps.yarnBoards.get(entityId);
        return {
            engineId: 'board',
            entityType: entityType,
            entityId: boardId !== null && boardId !== void 0 ? boardId : entityId,
            missing: boardId === undefined,
        };
    }
    if (engineId === 'brainstorm' || entityType === 'brainstorm') {
        var boardId = maps.brainstormBoards.get(entityId);
        return {
            engineId: 'board',
            entityType: 'board',
            entityId: boardId !== null && boardId !== void 0 ? boardId : entityId,
            missing: boardId === undefined,
        };
    }
    return { engineId: engineId, entityType: entityType, entityId: entityId };
}
function brainstormRef(item, maps) {
    var _a, _b, _c;
    if (!item.refEntityId || !item.refEntityType)
        return undefined;
    var preview = parsePreview(item.refPreviewData);
    var initialEngine = (_a = ENTITY_TYPE_ENGINES[item.refEntityType]) !== null && _a !== void 0 ? _a : item.refEntityType;
    var target = remapLegacyEntity(initialEngine, item.refEntityType, item.refEntityId, maps);
    return {
        engineId: target.engineId,
        entityType: (_b = target.entityType) !== null && _b !== void 0 ? _b : item.refEntityType,
        entityId: target.entityId,
        title: (_c = preview.title) !== null && _c !== void 0 ? _c : item.refEntityId,
        subtitle: preview.subtitle,
        thumbnail: preview.thumbnail,
        color: preview.color,
        missing: target.missing,
    };
}
function yarnEdgeKind(color) {
    switch (color.toLowerCase()) {
        case '#c4463a': return 'conflict';
        case '#4a9e6d': return 'alliance';
        case '#4a7ec4': return 'romance';
        case '#d4a843': return 'mystery';
        default: return 'related';
    }
}
function assertNodeBelongsToBoard(nodeProjectId, board, context) {
    if (nodeProjectId !== board.projectId) {
        throw new Error("Cannot migrate ".concat(context, ": project \"").concat(nodeProjectId, "\" does not own board \"").concat(board.id, "\"."));
    }
}
function remapConnectionEndpoint(rows, map, id, boardId, context) {
    var row = rows.get(id);
    if (!row || row.boardId !== boardId) {
        throw new Error("Cannot migrate ".concat(context, ": endpoint \"").concat(id, "\" is missing from board \"").concat(boardId, "\"."));
    }
    return mapped(map, id, context);
}
/**
 * Copy both retired canvas models into Board while all eleven stores coexist
 * in the v24 schema. Dexie runs this callback and the schema change in one
 * transaction: any validation/write failure leaves the database at v23 with
 * every legacy row intact. bulkPut plus deterministic IDs makes the body safe
 * to repeat before v25 removes the six source stores.
 */
function migrateLegacyBoards(tx) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, yarnBoards, yarnNodes, yarnEdges, brainstormBoards, brainstormItems, brainstormConnections, _b, yarnBoardIds, brainstormBoardIds, _c, yarnNodeIds, brainstormItemIds, _d, yarnEdgeIds, brainstormConnectionIds, maps, yarnBoardById, brainstormBoardById, yarnNodeById, brainstormItemById, boards, nodes, edges, swapEngines;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0: return [4 /*yield*/, Promise.all([
                        tx.table('yarnBoards').toArray(),
                        tx.table('yarnNodes').toArray(),
                        tx.table('yarnEdges').toArray(),
                        tx.table('brainstormBoards').toArray(),
                        tx.table('brainstormItems').toArray(),
                        tx.table('brainstormConnections').toArray(),
                    ])];
                case 1:
                    _a = _e.sent(), yarnBoards = _a[0], yarnNodes = _a[1], yarnEdges = _a[2], brainstormBoards = _a[3], brainstormItems = _a[4], brainstormConnections = _a[5];
                    _b = allocateIds(yarnBoards.map(function (row) { return row.id; }), brainstormBoards.map(function (row) { return row.id; }), 'board'), yarnBoardIds = _b[0], brainstormBoardIds = _b[1];
                    _c = allocateIds(yarnNodes.map(function (row) { return row.id; }), brainstormItems.map(function (row) { return row.id; }), 'node'), yarnNodeIds = _c[0], brainstormItemIds = _c[1];
                    _d = allocateIds(yarnEdges.map(function (row) { return row.id; }), brainstormConnections.map(function (row) { return row.id; }), 'edge'), yarnEdgeIds = _d[0], brainstormConnectionIds = _d[1];
                    maps = {
                        yarnBoards: yarnBoardIds,
                        brainstormBoards: brainstormBoardIds,
                        yarnNodes: yarnNodeIds,
                        brainstormItems: brainstormItemIds,
                        yarnEdges: yarnEdgeIds,
                        brainstormConnections: brainstormConnectionIds,
                    };
                    yarnBoardById = new Map(yarnBoards.map(function (row) { return [row.id, row]; }));
                    brainstormBoardById = new Map(brainstormBoards.map(function (row) { return [row.id, row]; }));
                    yarnNodeById = new Map(yarnNodes.map(function (row) { return [row.id, row]; }));
                    brainstormItemById = new Map(brainstormItems.map(function (row) { return [row.id, row]; }));
                    boards = __spreadArray(__spreadArray([], yarnBoards.map(function (row) { return ({
                        id: mapped(yarnBoardIds, row.id, 'Yarn board'),
                        projectId: row.projectId,
                        title: row.title,
                        // Neither legacy board persisted a surface. Use the same default as the
                        // current Board creation path; do not infer author intent from engine ID.
                        surface: 'cork',
                        createdAt: row.createdAt,
                        updatedAt: row.updatedAt,
                    }); }), true), brainstormBoards.map(function (row) { return ({
                        id: mapped(brainstormBoardIds, row.id, 'Brainstorm board'),
                        projectId: row.projectId,
                        title: row.title,
                        surface: 'cork',
                        createdAt: row.createdAt,
                        updatedAt: row.updatedAt,
                    }); }), true);
                    nodes = __spreadArray(__spreadArray([], yarnNodes.map(function (row) {
                        var _a, _b;
                        var owner = yarnBoardById.get(row.boardId);
                        if (!owner)
                            throw new Error("Cannot migrate Yarn node \"".concat(row.id, "\": board \"").concat(row.boardId, "\" is missing."));
                        assertNodeBelongsToBoard(row.projectId, owner, "Yarn node \"".concat(row.id, "\""));
                        var kind = yarnNodeKind(row.type);
                        var childIds = (_a = row.childNodeIds) === null || _a === void 0 ? void 0 : _a.map(function (id) { var _a; return (_a = yarnNodeIds.get(id)) !== null && _a !== void 0 ? _a : id; });
                        return {
                            id: mapped(yarnNodeIds, row.id, 'Yarn node'),
                            projectId: row.projectId,
                            boardId: mapped(yarnBoardIds, row.boardId, "Yarn node \"".concat(row.id, "\"")),
                            kind: kind,
                            role: kind === 'card' ? row.type : undefined,
                            title: row.title,
                            content: row.content,
                            richContent: row.richContent,
                            image: row.image,
                            imageOriginal: row.imageOriginal,
                            color: row.color,
                            position: __assign({}, row.position),
                            size: nodeSize(kind, row.width, row.height),
                            shape: row.shape,
                            zIndex: (_b = row.zIndex) !== null && _b !== void 0 ? _b : (kind === 'frame' ? -1 : 0),
                            tags: [],
                            props: (childIds === null || childIds === void 0 ? void 0 : childIds.length) ? { 'legacy.yarn.childNodeIds': JSON.stringify(childIds) } : undefined,
                            ref: row.linkedEntryId
                                ? {
                                    engineId: 'codex',
                                    entityType: 'codex-entry',
                                    entityId: row.linkedEntryId,
                                    title: row.title,
                                }
                                : undefined,
                            createdAt: owner.createdAt,
                            updatedAt: owner.updatedAt,
                        };
                    }), true), brainstormItems.map(function (row) {
                        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
                        var owner = brainstormBoardById.get(row.boardId);
                        if (!owner) {
                            throw new Error("Cannot migrate Brainstorm item \"".concat(row.id, "\": board \"").concat(row.boardId, "\" is missing."));
                        }
                        assertNodeBelongsToBoard(row.projectId, owner, "Brainstorm item \"".concat(row.id, "\""));
                        var kind = brainstormNodeKind(row.type);
                        var preview = parsePreview(row.refPreviewData);
                        var color = row.type === 'note'
                            ? ((_c = (_b = LEGACY_NOTE_COLORS[(_a = row.color) !== null && _a !== void 0 ? _a : '']) !== null && _b !== void 0 ? _b : row.color) !== null && _c !== void 0 ? _c : '#fef3c7')
                            : row.type === 'section'
                                ? ((_d = row.sectionColor) !== null && _d !== void 0 ? _d : '#6b7280')
                                : ((_e = preview.color) !== null && _e !== void 0 ? _e : catalog_1.DEFAULT_NODE_COLOR[kind]);
                        return {
                            id: mapped(brainstormItemIds, row.id, 'Brainstorm item'),
                            projectId: row.projectId,
                            boardId: mapped(brainstormBoardIds, row.boardId, "Brainstorm item \"".concat(row.id, "\"")),
                            kind: kind,
                            title: row.type === 'section'
                                ? ((_f = row.label) !== null && _f !== void 0 ? _f : '')
                                : row.type === 'entity-ref'
                                    ? ((_h = (_g = preview.title) !== null && _g !== void 0 ? _g : row.refEntityId) !== null && _h !== void 0 ? _h : '')
                                    : '',
                            content: (_j = row.content) !== null && _j !== void 0 ? _j : (0, htmlToText_1.htmlToText)(row.richContent),
                            richContent: row.richContent,
                            image: row.imageData,
                            imageOriginal: row.imageDataOriginal,
                            color: color,
                            position: __assign({}, row.position),
                            size: nodeSize(kind, row.width, row.height),
                            zIndex: kind === 'frame' ? -1 : 0,
                            tags: [],
                            ref: row.type === 'entity-ref' ? brainstormRef(row, maps) : undefined,
                            createdAt: row.createdAt,
                            updatedAt: row.updatedAt,
                        };
                    }), true);
                    edges = __spreadArray(__spreadArray([], yarnEdges.map(function (row) {
                        var _a, _b;
                        var owner = yarnBoardById.get(row.boardId);
                        if (!owner)
                            throw new Error("Cannot migrate Yarn edge \"".concat(row.id, "\": board \"").concat(row.boardId, "\" is missing."));
                        var sourceId = remapConnectionEndpoint(yarnNodeById, yarnNodeIds, row.sourceId, row.boardId, "Yarn edge \"".concat(row.id, "\""));
                        var targetId = remapConnectionEndpoint(yarnNodeById, yarnNodeIds, row.targetId, row.boardId, "Yarn edge \"".concat(row.id, "\""));
                        return {
                            id: mapped(yarnEdgeIds, row.id, 'Yarn edge'),
                            projectId: owner.projectId,
                            boardId: mapped(yarnBoardIds, row.boardId, "Yarn edge \"".concat(row.id, "\"")),
                            sourceId: sourceId,
                            targetId: targetId,
                            sources: [{ id: sourceId, on: 'node' }],
                            targets: [{ id: targetId, on: 'node' }],
                            kind: yarnEdgeKind(row.color),
                            label: row.label,
                            color: row.color,
                            style: row.style,
                            width: 0,
                            direction: (_a = row.direction) !== null && _a !== void 0 ? _a : 'none',
                            curvature: (_b = row.curvature) !== null && _b !== void 0 ? _b : 'curved',
                            weight: 1,
                            certainty: 1,
                            tags: [],
                            createdAt: owner.createdAt,
                            updatedAt: owner.updatedAt,
                        };
                    }), true), brainstormConnections.map(function (row) {
                        var _a, _b;
                        var owner = brainstormBoardById.get(row.boardId);
                        if (!owner) {
                            throw new Error("Cannot migrate Brainstorm connection \"".concat(row.id, "\": board \"").concat(row.boardId, "\" is missing."));
                        }
                        var sourceId = remapConnectionEndpoint(brainstormItemById, brainstormItemIds, row.sourceId, row.boardId, "Brainstorm connection \"".concat(row.id, "\""));
                        var targetId = remapConnectionEndpoint(brainstormItemById, brainstormItemIds, row.targetId, row.boardId, "Brainstorm connection \"".concat(row.id, "\""));
                        return {
                            id: mapped(brainstormConnectionIds, row.id, 'Brainstorm connection'),
                            projectId: owner.projectId,
                            boardId: mapped(brainstormBoardIds, row.boardId, "Brainstorm connection \"".concat(row.id, "\"")),
                            sourceId: sourceId,
                            targetId: targetId,
                            sources: [{ id: sourceId, on: 'node' }],
                            targets: [{ id: targetId, on: 'node' }],
                            kind: 'related',
                            label: row.label,
                            color: (_a = row.color) !== null && _a !== void 0 ? _a : '#9ca3af',
                            style: (_b = row.style) !== null && _b !== void 0 ? _b : 'solid',
                            width: 0,
                            direction: 'none',
                            curvature: 'curved',
                            weight: 1,
                            certainty: 1,
                            tags: [],
                            createdAt: owner.createdAt,
                            updatedAt: owner.updatedAt,
                        };
                    }), true);
                    if (!boards.length) return [3 /*break*/, 3];
                    return [4 /*yield*/, tx.table('boards').bulkPut(boards)];
                case 2:
                    _e.sent();
                    _e.label = 3;
                case 3:
                    if (!nodes.length) return [3 /*break*/, 5];
                    return [4 /*yield*/, tx.table('boardNodes').bulkPut(nodes)];
                case 4:
                    _e.sent();
                    _e.label = 5;
                case 5:
                    if (!edges.length) return [3 /*break*/, 7];
                    return [4 /*yield*/, tx.table('boardEdges').bulkPut(edges)];
                case 6:
                    _e.sent();
                    _e.label = 7;
                case 7:
                    swapEngines = function (list) {
                        if (!Array.isArray(list))
                            return undefined;
                        var mappedList = list.map(function (id) {
                            return id === 'yarn-board' || id === 'brainstorm' ? 'board' : id;
                        });
                        return mappedList.filter(function (id, index) { return mappedList.indexOf(id) === index; });
                    };
                    return [4 /*yield*/, tx.table('projects').toCollection().modify(function (project) {
                            var enabled = swapEngines(project.enabledEngines);
                            if (enabled)
                                project.enabledEngines = enabled;
                            var order = swapEngines(project.engineOrder);
                            if (order)
                                project.engineOrder = order;
                        })];
                case 8:
                    _e.sent();
                    return [4 /*yield*/, tx.table('annotations').toCollection().modify(function (row) {
                            if (typeof row.sourceEngineId !== 'string' || typeof row.sourceEntityId !== 'string')
                                return;
                            var target = remapLegacyEntity(row.sourceEngineId, undefined, row.sourceEntityId, maps);
                            row.sourceEngineId = target.engineId;
                            row.sourceEntityId = target.entityId;
                        })];
                case 9:
                    _e.sent();
                    return [4 /*yield*/, tx.table('annotationReferences').toCollection().modify(function (row) {
                            if (typeof row.targetEngineId !== 'string' || typeof row.targetEntityId !== 'string')
                                return;
                            var target = remapLegacyEntity(row.targetEngineId, undefined, row.targetEntityId, maps);
                            row.targetEngineId = target.engineId;
                            row.targetEntityId = target.entityId;
                        })];
                case 10:
                    _e.sent();
                    return [4 /*yield*/, tx.table('entityLinks').toCollection().modify(function (row) {
                            for (var _i = 0, _a = ['source', 'target']; _i < _a.length; _i++) {
                                var side = _a[_i];
                                var engineField = "".concat(side, "EngineId");
                                var typeField = "".concat(side, "EntityType");
                                var idField = "".concat(side, "EntityId");
                                if (typeof row[engineField] !== 'string' || typeof row[idField] !== 'string')
                                    continue;
                                var entityType = typeof row[typeField] === 'string' ? row[typeField] : undefined;
                                var target = remapLegacyEntity(row[engineField], entityType, row[idField], maps);
                                row[engineField] = target.engineId;
                                row[idField] = target.entityId;
                                if (target.entityType)
                                    row[typeField] = target.entityType;
                            }
                        })];
                case 11:
                    _e.sent();
                    return [4 /*yield*/, tx.table('conversionReceipts').toCollection().modify(function (row) {
                            for (var _i = 0, _a = ['source', 'target']; _i < _a.length; _i++) {
                                var side = _a[_i];
                                var engineField = "".concat(side, "EngineId");
                                var idField = "".concat(side, "EntityId");
                                if (typeof row[engineField] !== 'string' || typeof row[idField] !== 'string')
                                    continue;
                                var target = remapLegacyEntity(row[engineField], undefined, row[idField], maps);
                                row[engineField] = target.engineId;
                                row[idField] = target.entityId;
                            }
                        })];
                case 12:
                    _e.sent();
                    return [2 /*return*/];
            }
        });
    });
}
