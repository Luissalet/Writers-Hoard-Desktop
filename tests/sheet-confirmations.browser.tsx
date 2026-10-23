import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { Project } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';
import CharacterSheetsEngine from '@/engines/character-sheets/CharacterSheetsEngine';
import { createSheet } from '@/engines/character-sheets/types';
import { sheetDraftStore } from '@/engines/character-sheets/drafts';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = () => new Promise(done => setTimeout(done, 40));
export async function testSheetConfirmations(): Promise<string[]> {
  const host = document.getElementById('root')!, passed: string[] = [];
  for (const locale of ['en', 'es'] as const) {
    const es = locale === 'es', id = `sheet-confirmations-${locale}`, sheet = createSheet('coc7', 'Confirmation QA');
    sheet.revision = 1;
    sheet.resources.find(row => row.id === 'hp')!.current = 3;
    sheet.resources.find(row => row.id === 'sanity')!.current = 45;
    sheet.coc!.daySanityLoss = 5;
    const marked = sheet.skills.find(row => row.label === 'Spot Hidden')!;
    sheet.coc!.checkedSkills = [marked.id];
    const project: Project = { id, title: 'Confirmation QA', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#000', enabledEngines: ['character-sheets'], engineOrder: ['character-sheets'], createdAt: 1, updatedAt: 1, characterSheets: [sheet] };
    const root = createRoot(host);
    const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label);
    const click = async (node: HTMLElement | undefined) => { assert(node, 'Missing control'); await act(async () => { node.click(); await pause(); }); };
    const modal = () => { const node = document.querySelector<HTMLElement>('[role="dialog"]'); assert(node, 'Missing confirmation dialog'); return node; };
    const checkConfirm = () => { const node = modal(); assert(node.querySelector('h2')?.textContent === (es ? 'Confirmar' : 'Confirm') && button(es ? 'Confirmar' : 'Confirm', node) && !button(es ? 'Eliminar' : 'Delete', node), 'Non-destructive action is presented as deletion'); };
    try {
      await db.projects.put(project); sheetDraftStore(id).clear(); useLocaleStore.setState({ locale, loaded: true });
      await act(async () => { root.render(<MemoryRouter><CharacterSheetsEngine projectId={id} /></MemoryRouter>); await pause(); });
      await act(async () => { await pause(); });
      await click(button(es ? 'Atributos y habilidades' : 'Traits & skills'));
      await click(button(es ? 'Aplicar secundarios sugeridos' : 'Apply suggested secondary values'));
      checkConfirm(); await click(button(es ? 'Cancelar' : 'Cancel', modal()));
      assert(!sheetDraftStore(id).get(sheet.id), 'Cancel recalculation changed the draft');
      await click(button(es ? 'Aplicar secundarios sugeridos' : 'Apply suggested secondary values'));
      checkConfirm(); await click(button(es ? 'Confirmar' : 'Confirm', modal()));
      assert(sheetDraftStore(id).get(sheet.id)?.sheet.resources.find(row => row.id === 'hp')?.current === 10, 'Confirmed recalculation did not apply');
      await click(button(es ? 'Partida' : 'Play')); await click(button(es ? 'Comenzar nuevo día' : 'Start new day'));
      checkConfirm(); await click(button(es ? 'Confirmar' : 'Confirm', modal()));
      assert(sheetDraftStore(id).get(sheet.id)?.sheet.coc?.daySanityLoss === 0, 'Confirmed day reset did not apply');
      await click(button(es ? 'Mejorar' : 'Develop'));
      checkConfirm(); await click(button(es ? 'Confirmar' : 'Confirm', modal()));
      assert(!sheetDraftStore(id).get(sheet.id)?.sheet.coc?.checkedSkills.includes(marked.id), 'Confirmed development did not clear its mark');
      await click(button(es ? 'Eliminar ficha' : 'Delete sheet'));
      const deletion = modal(); assert(deletion.querySelector('h2')?.textContent === (es ? 'Eliminar' : 'Delete') && button(es ? 'Eliminar' : 'Delete', deletion), 'Real deletion lost its deletion title/action');
      await click(button(es ? 'Cancelar' : 'Cancel', deletion));
      assert((await db.projects.get(id))?.characterSheets?.length === 1, 'Cancel deletion removed the saved sheet');
      passed.push(`${locale}: recalculation/day/development use Confirm and execute; cancellation preserves the draft; real sheet deletion retains Delete`);
    } finally { await act(async () => { root.unmount(); }); sheetDraftStore(id).clear(); await db.projects.delete(id); }
  }
  return passed;
}
