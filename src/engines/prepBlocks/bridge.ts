// AI bridge — styled player handouts. wh_render_handout draws one without saving
// anything; wh_create_handout keeps it in the gallery (undoable) so a
// player-material block can reference it.
import { db } from '@/db';
import { BridgeError, optEnum, optNumber, optString, resolveProjectForEngine, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { HANDOUT_TEMPLATES, normalizeHandoutDefinition, renderHandoutPng } from './handouts';
import { saveHandout } from './operations';

function definitionFrom(args: ToolArgs) {
  const template = optEnum(args, 'template', HANDOUT_TEMPLATES);
  if (!template) throw new BridgeError('bad-args', `template is one of ${HANDOUT_TEMPLATES.join(', ')}.`);
  return normalizeHandoutDefinition({ template, title: optString(args, 'title'), body: optString(args, 'body'), signature: optString(args, 'signature'), extra: optString(args, 'extra'), lang: optString(args, 'lang') });
}

export const PREP_BLOCK_HANDLERS = {
  async wh_render_handout(args: ToolArgs) {
    const scale = optNumber(args, 'scale') ?? 1;
    if (scale < 0.2 || scale > 2) throw new BridgeError('bad-args', 'scale is between 0.2 and 2.');
    let definition;
    const imageId = optString(args, 'imageId');
    if (imageId) {
      const row = await db.inspirationImages.get(imageId);
      if (!row?.handout) throw new BridgeError('not-found', 'No handout with that id in the gallery; make one with wh_create_handout.');
      definition = normalizeHandoutDefinition(row.handout);
    } else definition = definitionFrom(args);
    if (!definition.body.trim() && !definition.title.trim()) throw new BridgeError('bad-args', 'Give a title or a body.');
    const png = await renderHandoutPng(definition, scale);
    return { template: definition.template, width: png.width, height: png.height, mimeType: 'image/png', base64: png.dataUrl.slice(png.dataUrl.indexOf(',') + 1) };
  },
  async wh_create_handout(args: ToolArgs) {
    const projectId = await resolveProjectForEngine(args, 'gallery');
    const definition = definitionFrom(args);
    if (!definition.body.trim() && !definition.title.trim()) throw new BridgeError('bad-args', 'Give a title or a body.');
    let row;
    try { row = await saveHandout(projectId, definition); } catch (error) { throw new BridgeError('failed', error instanceof Error ? error.message : 'The handout could not be saved.'); }
    return withAudit({ id: row.id, name: row.name, template: definition.template, hint: 'In a note: "> [!HANDOUT] <label> — <when to hand it out>" and a following line "> image: ' + row.id + '". Redraw it later with wh_render_handout imageId.' }, { projectId, entityId: row.id, summary: `made the ${definition.template} handout "${definition.title || row.name}"`, table: 'inspirationImages' });
  },
};
