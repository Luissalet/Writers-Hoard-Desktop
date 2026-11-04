// Logic gate for the Markdown document check:  node scripts/run-doc-check-tests.mjs
import assert from 'node:assert/strict';
import { checkMarkdownDoc, checkMarkdownCorpus, DOC_KINDS, RULES } from '@/engines/docCheck';

const FACT = 'The export dialog remembers the last folder the author chose and offers it again on the next export.';
const codes = (markdown: string, options = {}) => checkMarkdownDoc({ markdown }, options).diagnostics.map(d => d.rule);

const tests: Array<[string, () => void]> = [
  ['a page with no declared kind gets KND001, a host kind replaces it', () => {
    assert.deepEqual(codes('# Title\n\nPlain text.'), ['KND001']);
    const report = checkMarkdownDoc({ markdown: '# Title\n\nPlain text.' }, { kind: 'explanation' });
    assert.equal(report.kindSource, 'option'); assert.deepEqual(report.diagnostics, []);
  }],
  ['frontmatter declares the kind; unknown and generated are KND002', () => {
    const ok = checkMarkdownDoc({ markdown: '---\nkind: explanation\n---\n# T\n\nText.' });
    assert.equal(ok.kind, 'explanation'); assert.equal(ok.kindSource, 'frontmatter'); assert.equal(ok.ok, true);
    const bad = checkMarkdownDoc({ markdown: '---\nkind: poem\n---\n# T' });
    assert.equal(bad.diagnostics[0].rule, 'KND002'); assert.equal(bad.diagnostics[0].line, 2);
    assert.equal(checkMarkdownDoc({ markdown: '---\nkind: generated\n---\n# T\n\nI updated this.' }).diagnostics[0].rule, 'KND002');
    assert.equal(checkMarkdownDoc({ markdown: '---\nkind: readme\n# never closed' }).diagnostics[0].message.includes('not closed'), true);
  }],
  ['host-set generated pages skip content rules', () => {
    assert.deepEqual(codes('Here is the document you asked for. Currently 12 tests.', { kind: 'generated' }), []);
  }],
  ['kind content: how-to needs steps, ADR needs context and decision, reference holds no procedure, changelog needs releases', () => {
    assert.deepEqual(codes('# Install\n\nIt is easy.', { kind: 'howto' }), ['KND003']);
    assert.deepEqual(codes('# Install\n\n1. Download.\n2. Run `setup`.', { kind: 'howto' }), []);
    assert.deepEqual(codes('# Use\n\n```sh\nnpm run dev\n```', { kind: 'howto' }), []);
    assert.deepEqual(codes('# Run\n\n1. Do a.\n2. Do b.\n\n## Background\n\nWhy.', { kind: 'howto' }), ['KND003']);
    assert.deepEqual(codes('# Use tabs\n\n## Context\n\nx\n\n## Decision\n\ny', { kind: 'adr' }), []);
    assert.deepEqual(codes('# Use tabs\n\n## Decision\n\ny', { kind: 'adr' }), ['KND003']);
    assert.deepEqual(codes('# API\n\n1. a\n2. b\n3. c\n4. d', { kind: 'reference' }), ['KND003']);
    assert.deepEqual(codes('# Changes\n\n- stuff', { kind: 'changelog' }), ['KND003']);
    assert.deepEqual(codes('# Changes\n\n## 2026-11-04\n\n- stuff', { kind: 'changelog' }), []);
  }],
  ['a fact repeated in another page is DUP001 with a link to the original; the first page owns it', () => {
    const home = { id: 'a', title: 'Export', markdown: `# Export\n\nIntro.\n\n${FACT}` };
    const report = checkMarkdownDoc({ markdown: `Other text.\n\n- ${FACT.toLowerCase()}` }, { kind: 'reference', others: [home] });
    const dup = report.diagnostics.find(d => d.rule === 'DUP001')!;
    assert.equal(dup.line, 3); assert.equal(dup.original?.line, 5); assert.equal(dup.original?.link, '[Export](a#L5)');
    const corpus = checkMarkdownCorpus([home, { id: 'b', title: 'Other', markdown: `A sentence inside a longer paragraph. ${FACT} More words follow here.` }], { kind: 'reference' });
    assert.deepEqual(corpus[0].report.diagnostics, []); assert.equal(corpus[1].report.diagnostics[0].rule, 'DUP001');
    assert.deepEqual(codes('Short repeated line here.', { kind: 'reference', others: [{ markdown: 'Short repeated line here.' }] }), []);
  }],
  ['volatile values are flagged in durable pages only', () => {
    assert.deepEqual(codes('Writer 2.4.1 ships 394 tools and is currently in progress.', { kind: 'reference' }), ['VOL001', 'VOL001', 'VOL001', 'VOL001']);
    assert.deepEqual(codes('## 2.4.1\n\nShips 394 tools.', { kind: 'changelog' }), []);
    assert.deepEqual(codes('Ships 394 tools currently.', { kind: 'plan' }), []);
    assert.deepEqual(codes('Run `npm test`:\n\n```\n394 tools\n```', { kind: 'howto' }), []);
  }],
  ['vague pointers are PTR001 unless the block names a file, symbol or link', () => {
    assert.deepEqual(codes('For details see the code.', { kind: 'explanation' }), ['PTR001']);
    assert.deepEqual(codes('Para más detalle, consulta el código fuente.', { kind: 'explanation' }), ['PTR001']);
    assert.deepEqual(codes('For details see the code in `checker.ts`.', { kind: 'explanation' }), []);
    assert.deepEqual(codes('See the source: [checker](src/checker.ts).', { kind: 'explanation' }), []);
  }],
  ['pages that address the requester or narrate the edit are FIN001', () => {
    assert.deepEqual(codes('Here is the updated document you asked for.', { kind: 'explanation' }), ['FIN001']);
    assert.deepEqual(codes('He actualizado la página como me pediste.', { kind: 'explanation' }), ['FIN001']);
    assert.deepEqual(codes('## I added a section\n\nBody text.', { kind: 'explanation' }), ['FIN001']);
    assert.deepEqual(codes('The export dialog keeps its last folder.', { kind: 'explanation' }), []);
  }],
  ['exceptions with a reason suppress; without a reason they warn; unused ones warn', () => {
    const base = 'For details see the code.';
    const withReason = checkMarkdownDoc({ markdown: `<!-- doccheck: allow PTR001 -- the page is a stub on purpose. -->\n${base}` }, { kind: 'explanation' });
    assert.deepEqual(withReason.diagnostics, []); assert.equal(withReason.suppressed.length, 1); assert.equal(withReason.suppressed[0].reason, 'the page is a stub on purpose.');
    const noReason = checkMarkdownDoc({ markdown: `<!-- seiso: allow PTR001 -->\n${base}` }, { kind: 'explanation' });
    assert.deepEqual(noReason.diagnostics.map(d => [d.rule, d.severity]), [['SUP001', 'warning'], ['PTR001', 'error']]);
    const unused = checkMarkdownDoc({ markdown: '<!-- doccheck: allow DUP001 -- reason. -->\nPlain sentence here.' }, { kind: 'explanation' });
    assert.deepEqual(unused.diagnostics.map(d => d.rule), ['SUP002']);
    const other = checkMarkdownDoc({ markdown: `<!-- doccheck: allow VOL001 -- reason. -->\n${base}` }, { kind: 'explanation' });
    assert.deepEqual(other.diagnostics.map(d => d.rule), ['SUP002', 'PTR001']);
  }],
  ['every diagnostic carries line, rule, severity and a fix; disabled rules are skipped; rules table is complete', () => {
    const report = checkMarkdownDoc({ markdown: '# T\n\nSee the code.' });
    for (const d of report.diagnostics) { assert.ok(d.line >= 1 && d.rule && d.fix && d.message && RULES[d.rule]); }
    assert.deepEqual(codes('# T\n\nSee the code.', { disable: ['KND001', 'PTR001'] }), []);
    assert.deepEqual(Object.keys(RULES).sort(), ['DUP001', 'FIN001', 'KND001', 'KND002', 'KND003', 'PTR001', 'SUP001', 'SUP002', 'VOL001']);
    assert.ok(DOC_KINDS.includes('adr'));
  }],
];

export function runDocCheckTests(): string[] {
  return tests.map(([label, run]) => { run(); return label; });
}
