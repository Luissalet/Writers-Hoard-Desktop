import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import { buildWorldWiki, loadWorldWikiData, wikiCopy, WIKI_TYPES, type WorldWikiData } from '@/services/worldWikiExport';
import WikiExportControl from '@/engines/codex/WikiExportControl';
import { useLocaleStore } from '@/stores/localeStore';
import type { CodexEntry, Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export async function testWikiExport(): Promise<string[]> {
  const passed: string[] = [];
  const pid = `wiki-${Date.now()}`;
  const project: Project = { id: pid, title: 'El archipiélago </script><img src=x onerror=alert(1)>', description: 'Mundo de prueba <b>literal</b>', mode: 'novelist', type: 'standalone', status: 'draft', color: '#000', enabledEngines: ['codex'], engineOrder: ['codex'], createdAt: 1, updatedAt: 1 };
  const entry = (id: string, title: string, type: CodexEntry['type'], extra: Partial<CodexEntry> = {}): CodexEntry => ({ id, title, type, projectId: pid, fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1, ...extra });
  const evil = '\"><script>window.__injected = true</script><img src=x onerror=alert(1)>';
  const ana = entry('ana', 'Ana', 'character', { avatar: PNG, tags: ['marina', evil], fields: { rango: 'Capitana <b>literal</b>' }, content: '<h3>Biografía</h3><p>Guardiana del faro, nació en Málaga.</p><p><strong>Valiente</strong> <em>y leal</em></p><a href="/project/other/codex?entry=port">Puerto</a><a href="https://evil.invalid/codex?entry=port">Externo</a><img src="https://evil.invalid/tracker"><img src="data:image/svg+xml;base64,PHN2Zy8+"><script>window.__injected = true</script><iframe src="https://evil.invalid"></iframe><form><input id="search"></form><p id="wiki" class="pin" data-category="maps" onclick="alert(1)" style="position:fixed">Texto</p><img src="' + PNG + '">', relations: [{ targetId: 'port', targetTitle: 'Puerto', type: 'vive en' }, { targetId: 'excluded', targetTitle: evil, type: evil }] });
  const port = entry('port', 'Puerto de Málaga', 'location', { content: '<p>Un puerto de sal y piedra.</p>', tags: ['costa'] });
  const outside = entry('outside', 'FOREIGN SECRET', 'character', { projectId: `${pid}-other` });
  const data: WorldWikiData = { project, entries: [ana, port, outside], maps: [{ id: 'map', projectId: pid, title: 'Archipiélago', backgroundImage: PNG, createdAt: 1, updatedAt: 1 }, { id: 'outside-map', projectId: 'other', title: 'FOREIGN MAP', createdAt: 1, updatedAt: 1 }], pins: [{ id: 'pin', projectId: pid, mapId: 'map', name: 'Faro', description: 'Donde vive Ana.', position: { x: 25, y: 40 }, linkedEntryId: 'ana', icon: 'city' }, { id: 'badpin', projectId: pid, mapId: 'map', name: 'NaN', position: { x: NaN, y: Infinity }, icon: 'city' }, { id: 'crosspin', projectId: 'other', mapId: 'map', name: 'FOREIGN PIN', position: { x: 1, y: 1 }, icon: 'city' }], images: [{ id: 'image', projectId: pid, imageData: PNG, linkedEntryIds: ['ana'], notes: 'Retrato <literal>', tags: [], createdAt: 1 }, { id: 'crossimage', projectId: 'other', imageData: PNG, linkedEntryIds: ['ana'], notes: 'FOREIGN IMAGE', tags: [], createdAt: 1 }] };
  const artifact = buildWorldWiki(data, { locale: 'es' });
  assert(artifact.counts.entries === 2 && artifact.counts.maps === 1, 'Scope counts are incorrect');
  assert(!artifact.html.includes('FOREIGN'), 'Cross-project data leaked');
  assert(artifact.filename.endsWith('-wiki.html') && !artifact.filename.includes('<'), 'Unsafe download filename');
  passed.push('wiki: project boundaries and safe portable filename');

  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:1200px;height:900px;position:absolute;left:-2000px';
  document.body.append(frame);
  const urls: string[] = [];
  const open = async (html: string) => {
    const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }));
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    urls.push(url);
    frame.src = url; await loaded; await pause();
    assert(frame.contentDocument && frame.contentWindow, 'Exported wiki did not load');
    return frame.contentDocument;
  };
  try {
    const doc = await open(artifact.html);
    const win = frame.contentWindow!;
    const articles = [...doc.getElementById('wiki')!.children] as HTMLElement[];
    assert(doc.documentElement.lang === 'es' && articles.length === 3, 'Wiki did not render in Spanish');
    assert(!('__injected' in win), 'User script executed');
    assert(doc.querySelectorAll('script').length === 1, 'Unexpected active script');
    assert(!doc.querySelector('iframe, form, svg, [onclick], img[src="x"]'), 'Unsafe rich content survived');
    assert(!doc.querySelector('.prose [id], .prose [class], .prose [data-category]'), 'Rich content can impersonate wiki controls');
    assert(doc.querySelector('.prose strong')?.textContent === 'Valiente' && doc.querySelector('.prose em')?.textContent === 'y leal', 'Semantic formatting lost');
    assert([...doc.querySelectorAll('img')].every(img => img.src.startsWith('data:image/png;base64,')), 'A nonlocal image survived');
    assert([...doc.querySelectorAll('a[href]')].every(a => a.getAttribute('href')!.startsWith('#')), 'A network link survived');
    assert(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')?.includes("connect-src 'none'"), 'Offline CSP missing');
    passed.push('wiki: malicious HTML, attributes, tags and script-closing text stay inert; semantic rich text and local images preserved');

    const search = doc.getElementById('search') as HTMLInputElement;
    const category = doc.getElementById('category') as HTMLSelectElement;
    const tag = doc.getElementById('tag') as HTMLSelectElement;
    const trigger = (element: HTMLElement, event: string) => element.dispatchEvent(new win.Event(event, { bubbles: true }));
    search.value = 'malaga guardiana'; trigger(search, 'input');
    assert(articles.filter(article => !article.hidden).length === 1 && !articles[0].hidden, 'Accent-insensitive multiword body search failed');
    category.value = 'location'; trigger(category, 'change');
    assert(!doc.getElementById('empty')!.hidden && doc.getElementById('count')!.textContent === '0', 'Combined empty filters failed');
    search.value = ''; category.value = ''; tag.value = evil; trigger(tag, 'change');
    assert(!articles[0].hidden && articles[1].hidden, 'Exact hostile tag filtering failed');
    const portLink = doc.querySelector('.relations a') as HTMLAnchorElement;
    portLink.click(); await pause();
    assert(!articles[1].hidden && search.value === '' && category.value === '' && tag.value === '', 'Internal link did not clear hidden filters');
    assert(doc.querySelectorAll('article')[1].textContent!.includes('Ana'), 'Backlink missing');
    const marker = doc.querySelector('.pin') as HTMLAnchorElement;
    assert(marker && marker.style.left === '25%' && marker.style.top === '40%', 'Pin positions lost');
    category.value = 'character'; trigger(category, 'change'); marker.click(); await pause();
    assert(!articles[2].hidden, 'Map marker link did not reveal its filtered map');
    passed.push('wiki: executing exported search, type/tag filters, empty state, relation navigation, backlinks and map marker navigation');

    const reduced = buildWorldWiki(data, { locale: 'en', types: ['character'], includeImages: false, includeMaps: false });
    const reducedDoc = await open(reduced.html);
    assert(reduced.counts.entries === 1 && reduced.counts.maps === 0 && !reducedDoc.querySelector('img'), 'Export selection/images controls ignored');
    assert(reducedDoc.documentElement.lang === 'en' && reducedDoc.body.textContent!.includes('Entry not included'), 'English export or omitted relation label missing');
    const empty = await open(buildWorldWiki(data, { types: [], includeMaps: false }).html);
    assert(!empty.getElementById('empty')!.hidden, 'Empty wiki missing useful state');
    passed.push('wiki: English, category exclusion, omitted link targets, image-free export and empty state');
  } finally { frame.remove(); urls.forEach(url => URL.revokeObjectURL(url)); }

  const rootNode = document.getElementById('root')!;
  const root = createRoot(rootNode);
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalClick = HTMLAnchorElement.prototype.click;
  let downloaded: Blob | undefined;
  let filename = '';
  URL.createObjectURL = (blob: Blob | MediaSource) => { if (blob instanceof Blob) downloaded = blob; return 'blob:wiki-test'; };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () { filename = this.download; };
  try {
    await db.projects.add(project);
    await db.codexEntries.bulkAdd([ana, port, outside]);
    await db.worldMaps.bulkAdd(data.maps);
    await db.mapPins.bulkAdd(data.pins);
    await db.inspirationImages.bulkAdd(data.images);
    assert((await loadWorldWikiData(pid)).entries.length === 2, 'Database wiki loader scope is wrong');
    useLocaleStore.setState({ locale: 'es' });
    await act(async () => { root.render(<WikiExportControl projectId={pid} entries={[ana, port]} />); });
    for (let attempt = 0; attempt < 100 && !rootNode.querySelector('details'); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    (rootNode.querySelector('details') as HTMLDetailsElement).open = true;
    const box = (label: string) => [...rootNode.querySelectorAll<HTMLLabelElement>('label')].find(element => element.textContent?.trim() === label)?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    assert(WIKI_TYPES.every(type => box(wikiCopy('es').types[type])), 'Missing explicit export category selection');
    await act(async () => { box(wikiCopy('es').types.location)!.click(); box(wikiCopy('es').mapOption)!.click(); box(wikiCopy('es').images)!.click(); });
    const button = [...rootNode.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.includes(wikiCopy('es').download))!;
    await act(async () => { button.click(); await pause(100); });
    for (let attempt = 0; !downloaded && attempt < 20; attempt++) await act(async () => { await pause(50); });
    assert(downloaded && filename.endsWith('-wiki.html'), 'UI did not initiate HTML download');
    const downloadedDoc = new DOMParser().parseFromString(await downloaded.text(), 'text/html');
    assert(downloadedDoc.querySelectorAll('#wiki > article').length === 1 && !downloadedDoc.querySelector('img'), 'Actual UI download ignored category/maps/image selection');
    assert(rootNode.textContent!.includes(wikiCopy('es').done), 'Export success status missing');
    await act(async () => { useLocaleStore.setState({ locale: 'en' }); });
    assert(rootNode.textContent!.includes('Download HTML') && rootNode.textContent!.includes('Include maps and markers'), 'UI language did not update');
    passed.push('wiki: real database loader, explicit UI selection and actual HTML download work in Spanish and English');
  } finally {
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; HTMLAnchorElement.prototype.click = originalClick;
    await act(async () => root.unmount());
    await db.transaction('rw', [db.projects, db.codexEntries, db.worldMaps, db.mapPins, db.inspirationImages], async () => {
      await db.projects.delete(pid);
      await db.codexEntries.bulkDelete([ana.id, port.id, outside.id]);
      await db.worldMaps.bulkDelete(data.maps.map(map => map.id));
      await db.mapPins.bulkDelete(data.pins.map(pin => pin.id));
      await db.inspirationImages.bulkDelete(data.images.map(image => image.id));
    });
  }
  (window as unknown as { __wikiArtifact: string }).__wikiArtifact = artifact.html;
  return passed;
}
