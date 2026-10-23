// Wiki look and publishing: the palette catalogue and saved palettes, the terminal extras,
// footer links and signature, the "changes since the last edition" count and its bridge tool.
// An unchanged profile must still export the exact bytes it did before these features existed.
import '@/engines';
import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { exportProjectData, importProjectData, exportFullDatabase, importFullDatabase } from '@/db/operations';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import WikiAppearanceEditor from '@/engines/codex/WikiAppearanceEditor';
import WikiExportControl from '@/engines/codex/WikiExportControl';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { sha256Hex } from '@/services/judge/text';
import { saveWikiProfile, getWikiProfile, publishWikiProfile } from '@/services/wikiProfiles/store';
import { validateWikiOptions } from '@/services/wikiProfiles/validation';
import { wikiProfileChanges } from '@/services/wikiProfiles/changes';
import { WIKI_PALETTES } from '@/services/wikiProfiles/palettes';
import { WIKI_PROFILE_TOOLS, WIKI_OPTIONS_SCHEMA } from '@/services/wikiProfiles/bridgeManifest';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { useLocaleStore } from '@/stores/localeStore';
import type { WorldWikiOptions } from '@/types/worldWiki';
import { prepareWikiAppearance } from './wiki-appearance.browser';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => unknown | Promise<unknown>, label: string, tries = 150) { for (let i = 0; i < tries; i++) { if (await check()) return; await act(async () => { await pause(50); }); } throw new Error('Timed out: ' + label); }
const setValue = async (element: Element | null | undefined, value: string) => { assert(element, 'control missing'); const control = element as HTMLInputElement | HTMLSelectElement; await act(async () => { Object.getOwnPropertyDescriptor(control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(); }); };
const click = async (element: Element | null | undefined, label: string) => { assert(element, label); await act(async () => { (element as HTMLElement).click(); await pause(); }); };
const q = (host: Element, id: string) => host.querySelector(`[data-testid="${id}"]`);
const qa = (host: Element, id: string) => [...host.querySelectorAll(`[data-testid="${id}"]`)];
const rejects = (run: () => unknown) => { try { run(); } catch { return true; } return false; };
const build = async (project: string, options: WorldWikiOptions) => { const o = { locale: 'en' as const, ...options }; return buildWorldWiki(await loadWorldWikiData(project, o), o).html; };
// Mask the nonce and the bundler's numbered identifiers inside the embedded scripts, which change with the build.
const plain = (html: string) => html.replace(/nonce[-=]"?[0-9a-f]{36}/g, 'nonce-N').replace(/(<script[^>]*>)([\s\S]*?)(<\/script>)/g, (_all, open: string, body: string, close: string) => open + body.replace(/\b([A-Za-z_]+)\d+\b/g, '$1N') + close);
const channel = (hex: string) => { const f = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const [r, g, b] = [1, 3, 5].map(i => f(parseInt(hex.slice(i, i + 2), 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const [hi, lo] = [channel(a), channel(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
// Hashes of what these option sets exported BEFORE the look features existed (same fixture, nonce masked).
const BEFORE: Record<string, string> = { default: '26306f6fd818c0bf 30414', parchment: '26306f6fd818c0bf 30414', paper: '63efd4a72b4b053c 30414', night: '698b2c86c176cd1a 30402', forest: 'c8ec0bc369b60cc0 30414', journal: '9f78925d04848225 30620', terminal: '5470d673bc8e1866 30852', shell: '05f9065607b383e8 35029', profile: '85c210aadd454496 36870', profileTerminal: 'bb651cd4534e0e97 32780', profileSidebar: '5e69aa6fff4db7c5 32342' };

let latest: WorldWikiOptions = {};
function Harness({ initial, locale }: { initial: WorldWikiOptions; locale: 'es' | 'en' }) {
  const [options, setOptions] = useState<WorldWikiOptions>(initial);
  useEffect(() => { latest = options; }, [options]);
  const change = (patch: Partial<WorldWikiOptions> | ((current: WorldWikiOptions) => Partial<WorldWikiOptions>)) => setOptions(current => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }));
  return <WikiAppearanceEditor options={options} change={change} profiles={[]} locale={locale} busy={false} />;
}
async function mount(node: React.ReactNode) { const host = document.getElementById('root')!, root = createRoot(host); await act(async () => { root.render(node); await pause(200); }); return { host, unmount: async () => { await act(async () => { root.unmount(); await pause(); }); } }; }
function gradientPng() { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d')!; const g = x.createLinearGradient(0, 0, 32, 32); g.addColorStop(0, '#102030'); g.addColorStop(1, '#f0e0c0'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return c.toDataURL('image/png'); }

export async function testWikiLookChanges(): Promise<string[]> {
  const passed: string[] = [], P = 'wiki-look-base';
  const fixture = await prepareWikiAppearance(P), base = fixture.options;

  // 1. Unchanged profiles export the same bytes as before.
  const sets: Record<string, WorldWikiOptions> = { default: {}, parchment: { theme: 'parchment' }, paper: { theme: 'paper' }, night: { theme: 'night', font: 'sans' }, forest: { theme: 'forest', accent: '#aa3311' }, journal: { layout: 'journal' }, terminal: { layout: 'terminal' }, shell: { layout: 'shell' }, profile: base, profileTerminal: { ...base, layout: 'terminal' }, profileSidebar: { ...base, layout: 'sidebar' } };
  for (const [name, options] of Object.entries(sets)) { const html = plain(await build(P, options)); assert(`${(await sha256Hex(html)).slice(0, 16)} ${html.length}` === BEFORE[name], `Export of "${name}" changed from before the look features: ${(await sha256Hex(html)).slice(0, 16)} ${html.length}`); }
  const offHtml = plain(await build(P, { ...base, terminal: { scanlines: false, dither: false }, customPalettes: [], branding: { ...base.branding, links: [] } }));
  assert(offHtml === plain(await build(P, base)), 'Switched-off look options changed the export');
  passed.push(`Unchanged exports are byte-identical to before: ${Object.keys(BEFORE).length} option sets (default, four themes, journal, terminal, shell, a full appearance profile in three layouts) match their earlier hashes; empty/false new options change nothing`);

  // 2. Palette catalogue.
  assert(WIKI_PALETTES.length >= 20 && new Set(WIKI_PALETTES.map(p => p.id)).size === WIKI_PALETTES.length, 'Catalogue size or unique ids');
  for (const palette of WIKI_PALETTES) { validateWikiOptions({ colors: palette.colors }); assert(contrast(palette.colors.text, palette.colors.background) >= 7 && contrast(palette.colors.accent, palette.colors.background) >= 4.5 && contrast(palette.colors.text, palette.colors.secondary) >= 4.5, `Palette ${palette.id} is hard to read`); }
  const tinta = WIKI_PALETTES.find(p => p.id === 'tinta')!, tintaHtml = await build(P, { colors: tinta.colors });
  assert(tintaHtml.includes(`--paper:${tinta.colors.background}`) && tintaHtml.includes(`--ink:${tinta.colors.text}`), 'Palette colours not exported');
  passed.push(`Catalogue: ${WIKI_PALETTES.length} named palettes in 4 groups, every one validates and meets contrast (text 7:1, accent 4.5:1); a picked palette lands in the exported CSS`);

  // 3. Palette UI: pick, save, rename, delete (Spanish).
  useLocaleStore.setState({ locale: 'es' });
  let ui = await mount(<Harness initial={{ theme: 'night' }} locale="es" />);
  assert(!q(ui.host, 'wiki-terminal-editor'), 'Terminal extras shown on the sidebar layout');
  await setValue(q(ui.host, 'wiki-palette-select'), 'manuscrito');
  assert(latest.colors?.background === '#f8f1e0' && (q(ui.host, 'wiki-palette-select') as HTMLSelectElement).value === 'manuscrito', 'Picking a catalogue palette fills the five colours');
  await setValue(q(ui.host, 'wiki-palette-name'), 'Mi biblioteca');
  await click(q(ui.host, 'wiki-palette-save'), 'save palette');
  assert(latest.customPalettes?.length === 1 && latest.customPalettes[0].name === 'Mi biblioteca' && latest.customPalettes[0].colors.text === '#2b2418' && qa(ui.host, 'wiki-palette-row').length === 1, 'Saved palette kept five colours and listed');
  await setValue(q(ui.host, 'wiki-palette-name'), 'mi BIBLIOTECA'); await click(q(ui.host, 'wiki-palette-save'), 'duplicate name');
  assert(latest.customPalettes?.length === 1 && q(ui.host, 'wiki-palette-error')?.textContent?.includes('Ya tienes'), 'Duplicate name must be refused with a message');
  await setValue(q(ui.host, 'wiki-palette-select'), 'vino'); await setValue(q(ui.host, 'wiki-palette-name'), 'Granate nocturno'); await click(q(ui.host, 'wiki-palette-save'), 'second palette');
  assert(latest.customPalettes?.length === 2 && latest.customPalettes[1].colors.background === '#22121a', 'Second palette saved from another base');
  await setValue(q(ui.host, 'wiki-palette-select'), latest.customPalettes[0].id);
  assert(latest.colors?.accent === '#2b4a7a', 'A saved palette can be applied');
  await click(qa(ui.host, 'wiki-palette-rename')[0], 'rename'); await setValue(q(ui.host, 'wiki-palette-rename-input'), 'Biblioteca de casa'); await click(q(ui.host, 'wiki-palette-rename-ok'), 'rename ok');
  assert(latest.customPalettes?.[0].name === 'Biblioteca de casa' && latest.customPalettes[0].colors.accent === '#2b4a7a', 'Rename keeps the colours');
  await click(qa(ui.host, 'wiki-palette-rename')[0], 'rename again'); await setValue(q(ui.host, 'wiki-palette-rename-input'), 'Granate nocturno'); await click(q(ui.host, 'wiki-palette-rename-ok'), 'rename onto an existing name');
  assert(latest.customPalettes?.[0].name === 'Biblioteca de casa' && q(ui.host, 'wiki-palette-error'), 'Renaming onto an existing name must fail');
  await click(q(ui.host, 'wiki-palette-rename-cancel'), 'cancel rename');
  await click(qa(ui.host, 'wiki-palette-delete')[0], 'delete');
  assert(latest.customPalettes?.length === 1 && latest.customPalettes[0].name === 'Granate nocturno' && qa(ui.host, 'wiki-palette-row').length === 1, 'Delete removes only that palette');
  await click(q(ui.host, 'wiki-palette-clear'), 'back to theme'); assert(latest.colors === undefined && latest.customPalettes?.length === 1, 'Back to the theme drops colours, keeps palettes');
  const savedOptions: WorldWikiOptions = structuredClone(latest);
  await ui.unmount();
  for (const bad of [[{ id: 'a', name: 'x', colors: { background: '#fff', accent: '#000000', secondary: '#000000', text: '#000000', border: '#000000' } }], [{ id: 'a', name: 'x', colors: { background: '#ffffff', accent: '#000000', secondary: '#000000', text: '#000000' } }], [{ id: 'a', name: 'x', colors: { ...WIKI_PALETTES[0].colors } }, { id: 'a', name: 'y', colors: { ...WIKI_PALETTES[0].colors } }], [{ id: 'a', name: '', colors: { ...WIKI_PALETTES[0].colors } }], Array.from({ length: 25 }, (_, i) => ({ id: 'p' + i, name: 'n' + i, colors: { ...WIKI_PALETTES[0].colors } })), 'nope'] as unknown[]) assert(rejects(() => validateWikiOptions({ customPalettes: bad })), 'Invalid saved palettes accepted: ' + JSON.stringify(bad).slice(0, 60));
  passed.push('Palette UI (Spanish): pick a catalogue palette, "Guardar mi paleta", duplicate name refused, apply a saved one, rename (and refused onto an existing name), delete only that one, back to the theme; malformed saved palettes rejected');

  // 4. Saved palettes ride on the profile through JSON clone, full JSON and ZIP.
  let profile = await saveWikiProfile(P, { name: 'Look', options: { ...base, ...savedOptions, colors: tinta.colors, layout: 'shell', terminal: { phosphor: 'amber', scanlines: true, opening: [{ command: 'list', note: 'todo' }] }, branding: { ...base.branding, links: [{ label: 'Sitio', url: 'https://example.com/' }], signature: 'Firma' } } }, null);
  const mine = (options: WorldWikiOptions) => JSON.stringify([options.customPalettes, options.terminal, options.branding, options.colors, options.layout]), wanted = mine(profile.options);
  const clone = await importProjectData(await exportProjectData(P));
  assert(mine((await db.projects.get(clone))!.wikiProfiles![0].options) === wanted, 'JSON clone lost palettes/terminal/footer options');
  await importFullDatabase(await exportFullDatabase());
  const zip = await createProjectZipArchive(P); await importProjectZip(new File([zip.blob], 'look.zip', { type: 'application/zip' }), { replaceProjectIds: [P] });
  assert(mine((await getWikiProfile(P, profile.id)).options) === wanted, 'Full JSON/ZIP lost palettes/terminal/footer options');
  passed.push('Saved palettes, terminal extras and footer links live on the profile options: JSON clone, full JSON and ZIP restore them byte for byte (kept on the options, so no new backup registration is needed)');

  // 5. Terminal extras.
  const png = gradientPng();
  await db.worldMaps.update(P + '-map', { backgroundImage: png });
  const terminal = { phosphor: 'amber' as const, scanlines: true, dither: true, bootLine: 'BOOT <ok> 1', opening: [{ command: 'list', note: 'every page' }, { command: 'open <x>' }] };
  const shell = await build(P, { ...base, layout: 'shell', terminal });
  assert(shell.includes('--ink:#ffb000') && shell.includes('body::after') && shell.includes('img.wiki-dither') && shell.includes('<p class="wiki-boot">&gt; BOOT &lt;ok&gt; 1</p>') && shell.includes('data-wiki-command="list"') && shell.includes('New here?') && shell.includes('data-wiki-command="open &lt;x&gt;"') && shell.includes('every page'), 'Terminal extras missing when on');
  assert(shell.includes("script-src 'nonce-") && !/<script[^>]*src=/.test(shell) && shell.includes("default-src 'none'"), 'CSP changed by terminal extras');
  const spanishShell = await build(P, { ...base, layout: 'shell', locale: 'es', terminal });
  assert(spanishShell.includes('¿Primera vez por aquí?'), 'Opening list heading not localised');
  const marks = ['--ink:#ffb000', 'body::after', 'wiki-dither', 'wiki-boot', 'data-wiki-command', 'New here?'];
  const without = await build(P, { ...base, layout: 'shell' });
  assert(marks.every(mark => !without.includes(mark)), 'Terminal extras present when off');
  const sidebar = await build(P, { ...base, layout: 'sidebar', terminal });
  assert(marks.every(mark => !sidebar.includes(mark)), 'Terminal extras leaked into a non-terminal layout');
  const plainTerminal = await build(P, { ...base, layout: 'terminal', terminal });
  assert(plainTerminal.includes('--ink:#ffb000') && plainTerminal.includes('wiki-boot') && !plainTerminal.includes('data-wiki-command'), 'Terminal layout takes the look but has no command line for the opening list');
  for (const phosphor of ['amber', 'green', 'ice', 'purple', 'red'] as const) { const html = await build(P, { ...base, layout: 'terminal', terminal: { phosphor } }); assert(html.includes('--secondary:') && html.includes('color-scheme:dark'), 'Phosphor ' + phosphor); }
  for (const bad of [{ phosphor: 'pink' }, { scanlines: 'yes' }, { bootLine: 'a\nb' }, { bootLine: 'x'.repeat(121) }, { opening: Array.from({ length: 9 }, (_, i) => ({ command: 'c' + i })) }, { opening: [{ command: 'a' }, { command: 'a' }] }, { opening: [{ command: '' }] }, { opening: [{ command: 'a', extra: 1 }] }, { other: true }] as unknown[]) assert(rejects(() => validateWikiOptions({ terminal: bad })), 'Invalid terminal accepted: ' + JSON.stringify(bad));
  // Runtime: the opening buttons run the command, the dither filter turns pictures into two phosphor colours.
  const frame = document.createElement('iframe'); frame.setAttribute('sandbox', 'allow-scripts allow-same-origin'); frame.style.cssText = 'width:900px;height:600px'; frame.srcdoc = shell; document.body.append(frame);
  await until(() => frame.contentDocument?.readyState === 'complete' && frame.contentDocument.querySelector('[data-wiki-command="list"]'), 'frame loaded');
  const doc = frame.contentDocument!;
  (doc.querySelector('[data-wiki-command="list"]') as HTMLElement).click();
  await until(() => doc.querySelectorAll('#wiki-command-results li').length > 0, 'opening command ran');
  await until(() => doc.querySelector('.map-wrap > img.wiki-dither'), 'dither applied');
  const image = doc.querySelector('.map-wrap > img.wiki-dither') as HTMLImageElement;
  await until(() => image.complete && image.naturalWidth > 0, 'dithered image decoded');
  const probe = document.createElement('canvas'); probe.width = image.naturalWidth; probe.height = image.naturalHeight; const context = probe.getContext('2d')!; context.drawImage(image, 0, 0);
  const colours = new Set<string>(); const pixels = context.getImageData(0, 0, probe.width, probe.height).data; for (let i = 0; i < pixels.length; i += 4) colours.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
  assert(colours.size === 2 && colours.has('255,176,0'), 'Dither did not reduce the picture to the two phosphor colours: ' + [...colours].slice(0, 4).join('|'));
  frame.remove();
  passed.push('Terminal extras: phosphor (5), scanlines, dither, boot line and an editable opening list appear in the exported HTML only when on and only on terminal/shell (opening list needs the shell command line); CSP intact; in the page an opening button runs its command and the dither leaves exactly two phosphor colours; invalid extras rejected');

  // Terminal editor UI.
  ui = await mount(<Harness initial={{ layout: 'shell' }} locale="en" />);
  await setValue(q(ui.host, 'wiki-terminal-phosphor'), 'green'); await click(q(ui.host, 'wiki-terminal-scanlines'), 'scanlines'); await click(q(ui.host, 'wiki-terminal-dither'), 'dither'); await setValue(q(ui.host, 'wiki-terminal-boot'), 'READY');
  await click(q(ui.host, 'wiki-terminal-opening-defaults'), 'defaults');
  assert(latest.terminal?.phosphor === 'green' && latest.terminal.scanlines && latest.terminal.dither && latest.terminal.bootLine === 'READY' && latest.terminal.opening?.map(item => item.command).join() === 'help,list,home', 'Terminal editor writes the options');
  await setValue(qa(ui.host, 'wiki-terminal-opening-note')[1], 'all pages'); await click(qa(ui.host, 'wiki-terminal-opening-remove')[0], 'remove');
  assert(latest.terminal?.opening?.length === 2 && latest.terminal.opening[0].note === 'all pages', 'Opening rows edit/remove');
  await click(q(ui.host, 'wiki-terminal-scanlines'), 'scanlines off'); await click(q(ui.host, 'wiki-terminal-dither'), 'dither off'); await setValue(q(ui.host, 'wiki-terminal-phosphor'), ''); await setValue(q(ui.host, 'wiki-terminal-boot'), ''); await click(qa(ui.host, 'wiki-terminal-opening-remove')[1], 'r1'); await click(qa(ui.host, 'wiki-terminal-opening-remove')[0], 'r2');
  assert(latest.terminal === undefined, 'Turning every extra off must leave no terminal field');
  await ui.unmount();
  passed.push('Terminal editor UI: phosphor, scanlines, dither, boot line and opening rows write the options, and switching everything off leaves the profile without a terminal field');

  // 6. Footer links and signature.
  const branded: WorldWikiOptions = { ...base, branding: { ...base.branding, links: [{ label: 'Sitio <web>', url: 'https://example.com/a?b=1&c=2' }, { label: 'Correo', url: 'mailto:autor@example.com' }], signature: 'Hecho con <cariño>' } };
  const footer = await build(P, branded);
  assert(footer.includes('<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">Sitio &lt;web&gt;</a> · <a href="mailto:autor@example.com"') && footer.includes('<p class="wiki-signature">Hecho con &lt;cariño&gt;</p>') && footer.includes('&lt;literal footer&gt;'), 'Footer links/signature not rendered and escaped');
  assert(footer.includes("default-src 'none'") && footer.includes("style-src 'unsafe-inline'") && !footer.includes('navigate-to'), 'Footer links changed the CSP');
  const onlyLinks = await build(P, { branding: { links: [{ label: 'Solo', url: 'http://example.org' }] } }); assert(onlyLinks.includes('<footer class="wiki-footer"><p class="wiki-footer-links">'), 'Links without footer text still render');
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'file:///etc/passwd', 'https://', 'http://user:pw@example.com', 'https://exa mple.com', 'example.com', 'mailto:', '//example.com', 'https://example.com/"onclick="x', "https://example.com/'"]) assert(rejects(() => validateWikiOptions({ branding: { links: [{ label: 'x', url }] } })), 'Unsafe link accepted: ' + url);
  for (const bad of [{ links: Array.from({ length: 7 }, (_, i) => ({ label: 'l' + i, url: 'https://example.com/' + i })) }, { links: [{ label: '', url: 'https://example.com/' }] }, { links: [{ label: 'x', url: 'https://example.com/', extra: 1 }] }, { links: 'x' }, { signature: 'a\nb' }, { signature: 'x'.repeat(161) }] as unknown[]) assert(rejects(() => validateWikiOptions({ branding: bad })), 'Bad branding accepted: ' + JSON.stringify(bad).slice(0, 50));
  ui = await mount(<Harness initial={{}} locale="en" />);
  await click(q(ui.host, 'wiki-footer-link-add'), 'add link'); await setValue(q(ui.host, 'wiki-footer-link-label'), 'Home'); await setValue(q(ui.host, 'wiki-footer-link-url'), 'javascript:alert(1)');
  assert(q(ui.host, 'wiki-footer-link-error'), 'Unsafe address flagged in the editor');
  await setValue(q(ui.host, 'wiki-footer-link-url'), 'https://example.com/');
  await setValue(q(ui.host, 'wiki-footer-signature'), 'By hand');
  assert(!q(ui.host, 'wiki-footer-link-error') && latest.branding?.links?.[0].url === 'https://example.com/' && latest.branding.signature === 'By hand', 'Fixed address accepted');
  for (let i = 0; i < 5; i++) await click(q(ui.host, 'wiki-footer-link-add'), 'more links');
  assert((q(ui.host, 'wiki-footer-link-add') as HTMLButtonElement).disabled && qa(ui.host, 'wiki-footer-link-row').length === 6, 'Six links at most');
  await ui.unmount();
  passed.push('Footer: up to six http/https/mailto links plus a signature render escaped in the exported footer under the same CSP; javascript:, data:, file:, ftp:, credentials, quotes and malformed addresses are rejected; editor flags a bad address');

  // 7. Changes since the last edition.
  profile = await saveWikiProfile(P, { id: profile.id, name: 'Look', options: base }, profile.revision);
  const first = await wikiProfileChanges(P, profile.id);
  assert(first.lastEditionAt === null && first.count >= 3 && first.changes.every(item => item.change === 'added'), 'Without an edition every admitted document is new');
  profile = await publishWikiProfile(P, profile.id, profile.revision);
  const edition = profile.editions!.at(-1)!, same = await wikiProfileChanges(P, profile.id);
  assert(same.count === 0 && !same.sourceChanged && !same.configChanged && same.lastEditionAt === edition.publishedAt && same.editionId === edition.id, 'Right after publishing nothing has changed');
  await db.codexEntries.update(fixture.card.id, { content: '<p>Fresh harbour prose.</p>' });
  const one = await wikiProfileChanges(P, profile.id);
  assert(one.count === 1 && one.sourceChanged && one.changes[0].documentId === fixture.card.id && one.changes[0].kind === 'entry' && one.changes[0].change === 'changed' && one.changes[0].title === fixture.card.title, 'Editing a card counts as one changed document: ' + JSON.stringify(one.changes));
  await db.codexEntries.update(fixture.secret.id, { content: '<p>Another private line.</p>' });
  assert((await wikiProfileChanges(P, profile.id)).count === 1, 'Editing an excluded card must not count');
  await db.codexEntries.put({ ...fixture.card, id: P + '-new', title: 'Lighthouse', content: '<p>Tall.</p>', fields: {}, relations: [] }); await db.codexEntries.delete(P + '-other');
  const many = await wikiProfileChanges(P, profile.id), by = (id: string) => many.changes.find(item => item.documentId === id);
  assert(many.count === 3 && by(P + '-new')?.change === 'added' && by(P + '-new')?.title === 'Lighthouse' && by(P + '-other')?.change === 'removed' && by(P + '-other')?.title === 'West port' && by(fixture.card.id)?.change === 'changed' && many.changes.map(item => item.change).join() === 'added,changed,removed', 'Added/changed/removed list: ' + JSON.stringify(many.changes));
  const before = await getWikiProfile(P, profile.id), reply = await runBridgeTool('wh_wiki_profile_changes', { projectId: P, profileId: profile.id });
  assert(reply.ok && JSON.stringify((reply as unknown as { result: unknown }).result) === JSON.stringify(many), 'Bridge tool answers like the service: ' + JSON.stringify(reply).slice(0, 200));
  const after = await getWikiProfile(P, profile.id); assert(after.revision === before.revision && after.editions!.length === before.editions!.length, 'The changes tool must not write');
  assert(!(await runBridgeTool('wh_wiki_profile_changes', { projectId: P, profileId: 'missing' })).ok && !(await runBridgeTool('wh_wiki_profile_changes', { projectId: P })).ok, 'Bridge tool rejects unknown/missing profile');
  const tool = WIKI_PROFILE_TOOLS.find(item => item.name === 'wh_wiki_profile_changes')!;
  assert(tool && tool.writes === false && JSON.stringify(tool.schema.required) === '["profileId"]', 'Manifest entry is read-only with profileId');
  const properties = (WIKI_OPTIONS_SCHEMA.properties as Record<string, { properties?: Record<string, unknown> }>);
  assert(properties.terminal && properties.customPalettes && properties.branding.properties?.links && properties.branding.properties.signature, 'Profile schema describes the new options');
  profile = await publishWikiProfile(P, profile.id, after.revision);
  assert((await wikiProfileChanges(P, profile.id)).count === 0, 'Publishing resets the count');
  profile = await saveWikiProfile(P, { id: profile.id, name: 'Look', options: { ...base, theme: 'night' } }, profile.revision);
  const config = await wikiProfileChanges(P, profile.id); assert(config.configChanged && config.count === 0, 'A look-only change is reported as configuration, not documents');
  const saved = await runBridgeTool('wh_wiki_profile_save', { projectId: P, name: 'Bridge look', options: { layout: 'shell', terminal: { phosphor: 'ice', opening: [{ command: 'help' }] }, customPalettes: [{ id: 'c1', name: 'Mía', colors: { ...WIKI_PALETTES[0].colors } }], branding: { links: [{ label: 'Web', url: 'https://example.com/' }], signature: 'Yo' } }, expectedRevision: null });
  assert(saved.ok && (await getWikiProfile(P, (saved as unknown as { result: { id: string } }).result.id)).options.terminal?.phosphor === 'ice', 'Profiles can be written through the bridge with the new options: ' + JSON.stringify(saved).slice(0, 200));
  assert(!(await runBridgeTool('wh_wiki_profile_save', { projectId: P, name: 'Bad bridge', options: { branding: { links: [{ label: 'x', url: 'javascript:alert(1)' }] } }, expectedRevision: null })).ok, 'Bridge refuses an unsafe footer link');
  passed.push('Changes since the last edition: first publish counts every admitted document as added; right after publishing 0; editing a card = 1 changed; editing an excluded card = still 1; a new card, a deleted card and an edit give added,changed,removed; publishing resets to 0; a look-only change shows as configuration. Bridge wh_wiki_profile_changes (read-only, no writes) matches the service; profile save accepts the new options and refuses an unsafe link');

  // 8. Publish button and list in the real settings panel.
  useLocaleStore.setState({ locale: 'en' });
  const U = 'wiki-look-ui', uiFixture = await prepareWikiAppearance(U);
  let uiProfile = await saveWikiProfile(U, { name: 'Players', options: uiFixture.options }, null); uiProfile = await publishWikiProfile(U, uiProfile.id, uiProfile.revision);
  await db.codexEntries.update(uiFixture.card.id, { content: '<p>Changed after the edition.</p>' });
  const entries = await db.codexEntries.where('projectId').equals(U).toArray();
  const app = await mount(<MemoryRouter><main><WikiExportControl projectId={U} entries={entries} /></main></MemoryRouter>);
  await until(() => app.host.querySelector('summary'), 'settings');
  assert(!q(app.host, 'wiki-changes-panel') && !qa(app.host, 'wiki-changes-row').length, 'Nothing is computed before the section is opened or a profile chosen');
  await click(app.host.querySelector('summary'), 'open export');
  const select = [...app.host.querySelectorAll('label')].find(label => label.textContent?.startsWith('Profile'))!.querySelector('select')!;
  await setValue(select, uiProfile.id);
  await until(() => q(app.host, 'wiki-changes-count')?.textContent?.startsWith('1 document changed'), 'one change listed');
  const publish = () => [...app.host.querySelectorAll('button')].find(node => node.textContent?.startsWith('Publish ('));
  assert(publish()?.textContent === 'Publish (1 change)' && qa(app.host, 'wiki-changes-row').length === 1 && qa(app.host, 'wiki-changes-row')[0].getAttribute('data-change') === 'changed' && qa(app.host, 'wiki-changes-row')[0].textContent?.includes(uiFixture.card.title), 'Publish button shows the count and the row names the card');
  await db.codexEntries.update(U + '-other', { content: '<p>Second edit.</p>' });
  assert(publish()?.textContent === 'Publish (1 change)', 'Editing a card must not recompute by itself');
  await click(q(app.host, 'wiki-changes-refresh'), 'refresh');
  await until(() => publish()?.textContent === 'Publish (2 changes)', 'two changes after refresh');
  await click(publish(), 'publish');
  await until(async () => (await db.projects.get(U))!.wikiProfiles![0].editions!.length === 2, 'second edition');
  await until(() => publish()?.textContent === 'Publish (no changes)' && q(app.host, 'wiki-changes-count')?.textContent?.startsWith('Nothing changed'), 'count reset after publishing');
  await app.unmount();
  passed.push('Settings panel: nothing computed until opened; "Publish (1 change)" with the card named as changed; a further edit only shows after "Check changes" ("Publish (2 changes)"); publishing resets to "Publish (no changes)"');
  return passed;
}
