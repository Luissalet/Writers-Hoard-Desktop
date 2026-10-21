import type { BridgeTool } from './schema';
import { AREA_STYLES, BUILDING_STYLES, PLACE_LABEL_FONTS, PLACE_MODELS } from '@/engines/worldgen/core/placeStyleCatalog';

export const WORLD_STYLE_TOOLS: BridgeTool[] = [{
  name: 'wh_style_place', writes: true,
  description: 'Restyle a world place or territory through the same undoable edit as its inspector. Models use original procedural geometry in 2D, 3D and PNG. Omitted properties preserve current styling; auto/theme restore generated presentation. Area styles apply to realm keys and preserve ownership. labelVisible=true prioritizes the name within collision bounds; false restores normal density policy.',
  schema: { type: 'object', properties: {
    worldId: { type: 'string', description: 'Generated world ID.' }, key: { type: 'string', description: 'Stable key from wh_list_places/wh_find_place, or a regional sheet sourceKey.' },
    style: { type: 'object', additionalProperties: false, minProperties: 1, properties: {
      model: { type: 'string', enum: [...PLACE_MODELS] }, buildingStyle: { type: 'string', enum: [...BUILDING_STYLES] },
      labelFont: { type: 'string', enum: [...PLACE_LABEL_FONTS] }, labelSize: { type: 'number', minimum: .6, maximum: 2 },
      icon: { type: 'string', minLength: 1, maxLength: 16, description: 'city/town/fort/place, a landmark symbol id, or a custom short glyph.' },
      color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }, size: { type: 'number', minimum: .65, maximum: 2.4 }, labelVisible: { type: 'boolean' },
      areaStyle: { type: 'string', enum: [...AREA_STYLES] }, areaOpacity: { type: 'number', minimum: 0, maximum: 1, description: 'Multiplier of the map theme territory wash. Border ink stays visible.' },
    } },
  }, required: ['worldId', 'key', 'style'], additionalProperties: false },
}];
