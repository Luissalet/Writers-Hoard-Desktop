import type { BridgeTool } from './schema';
import { AREA_STYLES, BUILDING_STYLES, PLACE_LABEL_FONTS, PLACE_MODELS } from '@/engines/worldgen/core/placeStyleCatalog';
import { PLACE_CATALOG_NAMES,PLACE_CATALOG_ID } from '@/engines/worldgen/core/placeIconCatalog';

export const WORLD_STYLE_TOOLS: BridgeTool[] = [{
  name: 'wh_style_place', writes: true,
  description: 'Restyle a world place or territory through the same undoable edit as its inspector. Copied iconImage raster (up to 5 MiB encoded bytes) overrides its marker in 2D, planar 3D overlay and PNG; null removes it and reveals an available catalogIcon, then the saved model/symbol. catalogIcon uses Writer-owned PascalCase names and remains independent of retained models. Image/catalog do not apply to realm/road/label/stamp. Position lock permits styling. Omitted properties preserve current styling. Undo restores the entire previous edits list while its audit entry remains retained, not one style field. Area styles apply to realm keys and preserve ownership. labelVisible=true prioritizes the name within collision bounds; false restores normal density policy.',
  schema: { type: 'object', properties: {
    worldId: { type: 'string', description: 'Generated world ID.' }, key: { type: 'string', description: 'Stable key from wh_list_places/wh_find_place, or a regional sheet sourceKey.' },
    style: { type: 'object', additionalProperties: false, minProperties: 1, properties: {
      model: { type: 'string', enum: [...PLACE_MODELS] }, buildingStyle: { type: 'string', enum: [...BUILDING_STYLES] },
      labelFont: { type: 'string', enum: [...PLACE_LABEL_FONTS] }, labelSize: { type: 'number', minimum: .6, maximum: 2 },
      icon: { type: 'string', minLength: 1, maxLength: 16, description: 'city/town/fort/place, a landmark symbol id, or a custom short glyph.' },
      catalogIcon: {anyOf:[{type:'object',properties:{catalog:{type:'string',enum:[PLACE_CATALOG_ID]},name:{type:'string',enum:[...PLACE_CATALOG_NAMES]}},required:['catalog','name'],additionalProperties:false},{type:'null'}],description:'Own detached graphic symbol. Valid prepared raster wins when both are set; null removes only this level and reveals the retained model/legacy symbol. Omitted preserves the previous value. Uses existing aggregate edits Undo.'},
      iconImage: {anyOf:[{type:'object',properties:{dataUrl:{type:'string',description:'Copied local raster data URL: png/jpeg/webp/gif/avif/bmp, encoded bytes at most 5242880; decoder must accept it.'},mode:{type:'string',enum:['colour','inked']}},required:['dataUrl','mode'],additionalProperties:false},{type:'null'}],description:'Copied marker image, independent of Gallery. colour preserves channels; inked preserves alpha and uses effective marker ink. null reveals available catalog, then prior model/symbol.'},
      color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }, size: { type: 'number', minimum: .65, maximum: 2.4 }, labelVisible: { type: 'boolean' },
      areaStyle: { type: 'string', enum: [...AREA_STYLES] }, areaOpacity: { type: 'number', minimum: 0, maximum: 1, description: 'Multiplier of the map theme territory wash. Border ink stays visible.' },
    } },
  }, required: ['worldId', 'key', 'style'], additionalProperties: false },
}];
