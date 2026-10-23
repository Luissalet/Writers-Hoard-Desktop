import { PROJECT_ID, n, s, type BridgeTool } from '@/services/aiBridge/schema';
import { HANDOUT_TEMPLATES } from './handouts';

const fields = {
  template: s('Style: letter, casefile (case file), terminal (terminal screen) or noticeboard.', { enum: [...HANDOUT_TEMPLATES] }),
  title: s('Heading: letter heading, case name, system name or board sign. Up to 120 characters.'),
  body: s('The text, up to 4000 characters. A notice board takes one notice per paragraph (first line = its heading); a terminal shows lines starting with ">" brighter.'),
  signature: s('Signature (letter), investigator (case file) or footer (terminal). Up to 80 characters.'),
  extra: s('Place and date (letter), file number (case file), login line (terminal) or subtitle (notice board). Up to 120 characters.'),
  lang: s('Language of fixed words such as "CONFIDENTIAL": es or en (default es).', { enum: ['es', 'en'] }),
};

export const PREP_BLOCK_TOOLS: BridgeTool[] = [
  {
    name: 'wh_render_handout', writes: false, group: 'visual',
    description: 'Draw a styled player handout (letter, case file, terminal screen or notice board) and return it as a PNG in base64 plus its size. Nothing is saved. Give the text fields, or imageId of a handout already in the gallery to redraw it from its editable text. scale 0.2-2 (default 1).',
    schema: { type: 'object', properties: { projectId: PROJECT_ID, imageId: s('Gallery image id of a saved handout (from wh_create_handout). Replaces the text fields.'), ...fields, scale: n('Pixel scale of the PNG, 0.2 to 2.', { minimum: 0.2, maximum: 2 }) }, additionalProperties: false },
  },
  {
    name: 'wh_create_handout', writes: true, group: 'visual', engineId: 'gallery',
    description: 'Draw a styled player handout and keep it in the project\'s gallery (tagged "handout", with its editable text), ready for the "Material para jugadores" block to point at: write that block in a note as "> [!HANDOUT] Carta del barón — al llegar a la posada" followed by "> image: <returned id>". Returns the gallery image id. Undo with wh_undo.',
    schema: { type: 'object', properties: { projectId: PROJECT_ID, ...fields }, required: ['template'], additionalProperties: false },
  },
];
