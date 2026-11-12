import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import '@/engines';
import CharacterSheetsEngine from '@/engines/character-sheets/CharacterSheetsEngine';
import { sheetDraftStore } from '@/engines/character-sheets/drafts';
import { applySheetInk } from '@/engines/character-sheets/ink';
import { saveSheet } from '@/engines/character-sheets/operations';
import { sheetPaper } from '@/engines/character-sheets/paper';
import { createSheet, exportSheet, parseSheetImport, type CharacterSheet } from '@/engines/character-sheets/types';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';

function check(value: unknown, label: string): asserts value {
  if (!value) throw Error(label);
}

async function until(test: () => boolean | Promise<boolean>, label: string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await test()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)); });
  }
  throw Error(label);
}

export async function mountDaggerheartAdversaryFixture(includeCharacter = false) {
  const projectId = 'qa-dh-adversary-' + crypto.randomUUID();
  const initial = createSheet('daggerheart-adversary', 'Harbour guard');
  initial.numbers.tier = 6;
  initial.details.adversaryType = 'River kin';
  const legacyRow = { id: 'legacy', section: 'Features', name: 'Old instructions',
    detail: 'Guard the north gate.', expression: '1d4', quantity: 2 };
  initial.rows.push(legacyRow);
  const eraId = 'past';
  await db.projects.add({
    id: projectId, title: 'QA Daggerheart adversary', description: '', mode: 'custom', type: 'standalone', status: 'draft',
    color: '#334455', enabledEngines: ['character-sheets'], createdAt: 1, updatedAt: 1,
    worldEras: [{ id: eraId, name: 'Past', description: '', revision: 1, createdAt: 1, updatedAt: 1 }],
  });
  const sheet = await saveSheet(projectId, initial, null);
  if (includeCharacter) await saveSheet(projectId, createSheet('daggerheart-character', 'Harbour wizard'), null);

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  useLocaleStore.setState({ locale: 'en', loaded: true });
  const route = '/project/' + projectId + '/character-sheets?entity=' + sheet.id;
  const byLabel = <T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(label: string) => {
    const node = [...container.querySelectorAll<T>('input,select,textarea')].find(element =>
      element.getAttribute('aria-label') === label ||
      [...(element.labels ?? [])].some(item => item.firstChild?.textContent?.trim() === label));
    check(node, 'Missing field ' + label);
    return node;
  };
  const button = (label: string) => {
    const node = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.getAttribute('aria-label') === label || item.textContent?.trim() === label);
    check(node, 'Missing button ' + label);
    return node;
  };
  async function cleanup() {
    if (container.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
    sheetDraftStore(projectId).delete(sheet.id);
    if (await db.projects.get(projectId)) await deleteProject(projectId);
  }
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={[route]}>
      <CharacterSheetsEngine projectId={projectId} />
    </MemoryRouter>));
    await until(() => !!container.querySelector('select[aria-label="Tier"]'), 'Adversary Play view did not mount');
    return { projectId, sheet, eraId, legacyRow, container, byLabel, button, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function click(node: HTMLButtonElement) {
  await act(async () => node.click());
}

async function fill(node: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

export async function testDaggerheartAdversary(): Promise<string[]> {
  const fixture = await mountDaggerheartAdversaryFixture();
  const { projectId, eraId, container, byLabel, button, sheet, legacyRow } = fixture;
  const checks: string[] = [];
  const scope = { projectId, sheetId: sheet.id };
  async function call<T>(tool: string, args: Record<string, unknown> = {}) {
    const reply = await runBridgeTool(tool, { ...scope, ...args });
    check(reply.ok, tool + ' failed: ' + JSON.stringify(reply));
    return reply.result as T;
  }
  try {
    const tier = byLabel<HTMLSelectElement>('Tier'), type = byLabel<HTMLSelectElement>('Adversary type');
    check(tier.value === '6' && type.value === 'River kin' && container.textContent?.includes(legacyRow.detail),
      'Old tier, custom type, or free feature changed on load');
    check(button('Save sheet').disabled, 'Opening the legacy sheet created an edit');
    checks.push('Opening old sheets retains a custom tier, type and generic feature without a write');

    await fill(tier, '3');
    await fill(type, 'Horde');
    await fill(byLabel('Standard attack'), 'Sweep');
    check(container.textContent?.includes('Party level 5–7'), 'Tier 3 did not display its level range');
    await click(button('HP marked: 3'));
    await click(button('Stress marked: 2'));
    await click(button('Add experience'));
    await fill(byLabel('Experience 1'), 'Fog patrol');
    await fill(byLabel('Modifier for Experience 1'), '-2');
    await click(button('Add feature'));
    await fill(byLabel('Feature 1'), 'Sound the bell');
    await fill(byLabel('Kind of Feature 1'), 'reaction');
    await fill(byLabel('Text of Feature 1'), 'On arrival, raise the signal <bell>.');
    await click(button('Save sheet'));
    const readBase = () => call<{ sheet: CharacterSheet }>('wh_sheet_get');
    await until(async () => (await readBase()).sheet.revision > sheet.revision, 'Sheet did not save');
    const base = (await readBase()).sheet;
    const experience = base.rows.find(row => row.name === 'Fog patrol');
    const feature = base.rows.find(row => row.name === 'Sound the bell');
    check(base.numbers.tier === 3 && base.details.adversaryType === 'Horde' && base.details.weapon === 'Sweep' &&
      base.resources.find(resource => resource.id === 'hp')?.current === 3 &&
      base.resources.find(resource => resource.id === 'stress')?.current === 2, 'Tier, type, attack or marks did not save');
    check(experience?.daggerheartAdversary?.kind === 'experience' && experience.daggerheartAdversary.modifier === -2 &&
      feature?.daggerheartAdversary?.kind === 'feature' && feature.daggerheartAdversary.category === 'reaction' &&
      JSON.stringify(base.rows[0]) === JSON.stringify(legacyRow), 'Typed rows did not save beside the exact generic row');
    checks.push('The real editor saves Tier 3, type, attack, resource marks and typed rows with the previous row intact');

    const exported = parseSheetImport(exportSheet(base));
    check(JSON.stringify(exported.rows) === JSON.stringify(base.rows), 'Portable sheet JSON lost typed metadata or row IDs');
    const paper = sheetPaper(base, 'en').svg;
    const spanish = sheetPaper(base, 'es').svg;
    check(paper.includes('Adversary features') && paper.includes('Party level') && paper.includes('5–7') &&
      paper.includes('Reaction') && paper.includes('-2') && paper.includes('&lt;bell&gt;') && spanish.includes('Reacción'),
    'Paper lost the experience, feature, level range, localization or escaping');
    checks.push('JSON and Paper preserve the typed rows and localized level and feature labels');

    const featureHeadingY = (svg: string) => Number([...new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('text')]
      .find(node => node.textContent === 'Adversary features')?.getAttribute('y'));
    const y = featureHeadingY(paper);
    check(Number.isFinite(y) && y > 0, 'Could not locate the adversary feature heading on paper');
    const stroke = { id: 'feature-marker', tool: 'marker' as const, color: '#272b2b', width: 8,
      points: [{ x: 48, y }, { x: 220, y }] };
    const inked = applySheetInk(base, { kind: 'stroke', stroke });
    const erased = applySheetInk(inked, { kind: 'stroke', stroke: { ...stroke, id: 'feature-eraser', tool: 'eraser' } });
    const undone = applySheetInk(erased, { kind: 'undo' });
    check([inked, erased, undone].every(item => featureHeadingY(sheetPaper(item).svg) === y),
      'Drawing or erasing ink moved the adversary feature heading');
    checks.push('Paper coordinates remain stable while marking, erasing and undoing ink over an adversary feature');

    const branch = structuredClone(base);
    const changed = branch.rows.find(row => row.id === experience.id)!;
    changed.daggerheartAdversary = { kind: 'experience', modifier: 4 };
    await call('wh_sheet_update', { eraId, revision: base.revision, sheet: branch });
    const past = (await call<{ sheet: CharacterSheet }>('wh_sheet_get', { eraId })).sheet;
    const pastExperience = past.rows.find(row => row.id === experience.id)?.daggerheartAdversary;
    check(pastExperience?.kind === 'experience' && pastExperience.modifier === 4 &&
      JSON.stringify((await readBase()).sheet) === JSON.stringify(base), 'The era did not retain its own modifier');
    const bad = structuredClone(past);
    bad.rows.find(row => row.id === feature.id)!.daggerheartAdversary = { kind: 'feature', category: 'legendary' as 'reaction' };
    const invalid = await runBridgeTool('wh_sheet_update', { ...scope, eraId, revision: past.revision, sheet: bad });
    const stale = await runBridgeTool('wh_sheet_update', { ...scope, eraId, revision: base.revision, sheet: branch });
    check(!invalid.ok && !stale.ok && JSON.stringify((await call<{ sheet: CharacterSheet }>('wh_sheet_get', { eraId })).sheet) === JSON.stringify(past),
      'Invalid or stale metadata changed the stored sheet');
    checks.push('MCP writes scoped typed rows under CAS and rejects invalid categories and stale revisions');
    return checks;
  } finally { await fixture.cleanup(); }
}
