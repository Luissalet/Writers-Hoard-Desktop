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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FACTION_FIELDS = exports.ITEM_FIELDS = exports.LOCATION_FIELDS = exports.CHARACTER_FIELDS = void 0;
exports.getTemplateFields = getTemplateFields;
// Templates for Codex entries
exports.CHARACTER_FIELDS = {
    name: '',
    age: '',
    species: '',
    role: '',
    physicalDescription: '',
    personality: '',
    backstory: '',
    abilities: '',
    goals: '',
    flaws: '',
};
exports.LOCATION_FIELDS = {
    name: '',
    region: '',
    climate: '',
    population: '',
    history: '',
    notableFeatures: '',
    inhabitants: '',
};
exports.ITEM_FIELDS = {
    name: '',
    type: '',
    origin: '',
    properties: '',
    history: '',
    currentOwner: '',
};
exports.FACTION_FIELDS = {
    name: '',
    type: '',
    leader: '',
    goals: '',
    territory: '',
    allies: '',
    enemies: '',
    history: '',
};
function getTemplateFields(type) {
    switch (type) {
        case 'character': return __assign({}, exports.CHARACTER_FIELDS);
        case 'location': return __assign({}, exports.LOCATION_FIELDS);
        case 'item': return __assign({}, exports.ITEM_FIELDS);
        case 'faction': return __assign({}, exports.FACTION_FIELDS);
        default: return { name: '' };
    }
}
