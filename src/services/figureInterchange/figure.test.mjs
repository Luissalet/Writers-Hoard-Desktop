import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { parsePortableFigure, figureFingerprint, FigureImportError } from './index.ts';

// Independent tiny PNG encoder for synthetic contract fixtures, not a parser oracle.
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function png() {
  function chunk(type, bytes) {
    const body = Buffer.concat([Buffer.from(type), bytes]), result = Buffer.alloc(bytes.length + 12);
    result.writeUInt32BE(bytes.length); body.copy(result, 4); result.writeUInt32BE(crc(body), result.length - 4);
    return result;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(32); ihdr.writeUInt32BE(16, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(16 * (1 + 32 * 3), 0))), chunk('IEND', Buffer.alloc(0))]);
}
const bytes = png();
function fixture() {
  return { format: 'vitruvius.figure/1', document_id: '012345abcdef', revision: 4, title: 'Mecanismo sintético',
    page_id: null, state_id: 'open', content: { diagram: { type: 'isometric', nodes: [] },
      mechanism: { parts: [{ id: 'lid', description: 'Fuente completa, sin truncar.\n'.repeat(8000) }], states: [{ id: 'open' }, { id: 'closed' }] } },
    origin: { editor_url: 'http://127.0.0.1:5191/design/#/diagrams?document=012345abcdef', source_url: 'http://127.0.0.1:5191/design/source.json?revision=4' },
    preview: { mime: 'image/png', data: bytes.toString('base64'), future_preview: { retain: true } },
    future_optional: { nested: ['á', '漢字', { value: 3.5 }] } };
}

test('full JSON, original text, unknown fields and PNG bytes survive without mutating input', () => {
  const source = fixture(), before = structuredClone(source), raw = `\n${JSON.stringify(source, null, 2)}\n`;
  const parsed = parsePortableFigure(raw);
  assert.deepEqual(parsed.figure, before);
  assert.equal(parsed.sourceJson, raw);
  assert.deepEqual(Buffer.from(parsed.png), bytes);
  assert.deepEqual([parsed.width, parsed.height], [32, 16]);
  assert.equal(parsed.pngValidation, 'signature-and-dimensions');
  const objectInput = parsePortableFigure(source);
  objectInput.figure.content.mechanism.parts[0].description = 'Only the returned copy changes';
  assert.deepEqual(source, before);
});

test('legacy graph/null selection and multi-page source remain complete', () => {
  const graph = fixture(); delete graph.state_id; delete graph.origin; graph.content = { diagram: { type: 'flowchart', nodes: [] } };
  assert.deepEqual(parsePortableFigure(graph).figure, graph);
  const pages = fixture(); delete pages.state_id; pages.page_id = 'p2'; pages.content.diagram.type = 'infographic';
  pages.content.view = { pages: [{ id: 'p1' }, { id: 'p2' }] };
  assert.deepEqual(parsePortableFigure(pages).figure, pages);
});

test('identity covers source, revision and selection even for identical PNG, independent of key order', async () => {
  const original = fixture(), key = await figureFingerprint(parsePortableFigure(original).figure);
  assert.equal(key.length, 64);
  assert.equal(await figureFingerprint(parsePortableFigure(Object.fromEntries(Object.entries(original).reverse())).figure), key);
  for (const change of [f => { f.revision++; }, f => { f.state_id = 'closed'; }, f => { f.content.mechanism.parts[0].description += 'Otra fuente'; }]) {
    const changed = fixture(); change(changed);
    assert.equal(changed.preview.data, original.preview.data);
    assert.notEqual(await figureFingerprint(parsePortableFigure(changed).figure), key);
  }
  const pages = fixture(); delete pages.state_id; pages.page_id = 'p1'; pages.content.view = { pages: [{ id: 'p1' }, { id: 'p2' }] };
  const first = await figureFingerprint(parsePortableFigure(pages).figure); pages.page_id = 'p2';
  assert.notEqual(await figureFingerprint(parsePortableFigure(pages).figure), first);
});

for (const [name, field, change] of [
  ['unknown format', 'format', f => { f.format = 'vitruvius.figure/2'; }],
  ['missing identity', 'document_id', f => { delete f.document_id; }],
  ['boolean revision', 'revision', f => { f.revision = true; }],
  ['zero revision', 'revision', f => { f.revision = 0; }],
  ['unsafe revision', 'revision', f => { f.revision = Number.MAX_SAFE_INTEGER + 1; }],
  ['missing source', 'content', f => { f.content = {}; }],
  ['missing captured state', 'state_id', f => { f.state_id = 'absent'; }],
  ['wrong diagram for state', 'state_id', f => { f.content.diagram.type = 'flowchart'; }],
  ['simultaneous page/state', 'state_id', f => { f.page_id = 'p1'; f.content.view = { pages: [{ id: 'p1' }] }; }],
  ['unknown page', 'page_id', f => { delete f.state_id; f.page_id = 'p3'; }],
  ['malformed pages', 'page_id', f => { delete f.state_id; f.page_id = 'p1'; f.content.view = []; }],
  ['active origin', 'origin.editor_url', f => { f.origin.editor_url = 'javascript:alert(1)'; }],
  ['credentials in origin', 'origin.editor_url', f => { f.origin.editor_url = 'https://user:secret@example.com'; }],
  ['wrong preview type', 'preview', f => { f.preview.mime = 'image/jpeg'; }],
  ['invalid base64', 'preview.data', f => { f.preview.data = '*invalid*'; }],
  ['truncated PNG header', 'preview.data', f => { f.preview.data = bytes.subarray(0, 20).toString('base64'); }],
  ['wrong PNG signature', 'preview.data', f => { const bad = Buffer.from(bytes); bad[0] = 0; f.preview.data = bad.toString('base64'); }],
  ['zero dimensions', 'preview.data', f => { const bad = Buffer.from(bytes); bad.writeUInt32BE(0, 16); f.preview.data = bad.toString('base64'); }],
]) {
  test(`reject ${name} with a concrete field and unchanged input`, () => {
    const input = fixture(); change(input); const before = structuredClone(input);
    assert.throws(() => parsePortableFigure(input), error => error instanceof FigureImportError && error.field === field);
    assert.deepEqual(input, before);
  });
}

test('malformed JSON, non-object and non-JSON input report source errors', () => {
  for (const input of ['{', 'null', '[]', undefined, { content: () => 'discarded' }]) {
    assert.throws(() => parsePortableFigure(input), error => error instanceof FigureImportError && error.field === 'source');
  }
  const circular = {}; circular.self = circular;
  assert.throws(() => parsePortableFigure(circular), FigureImportError);
});

test('header inspection explicitly does not certify pixel decoding', () => {
  const truncatedPixels = fixture(); truncatedPixels.preview.data = bytes.subarray(0, 33).toString('base64');
  const parsed = parsePortableFigure(truncatedPixels);
  assert.equal(parsed.pngValidation, 'signature-and-dimensions');
  assert.deepEqual(Buffer.from(parsed.png), bytes.subarray(0, 33));
});
