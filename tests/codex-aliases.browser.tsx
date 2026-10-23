// Alias chips on a codex card: names suggested from the title, a common word
// refused with its reason, saved with the card; the matcher never links text
// by a common word; the bridge checks and offers the same.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { CodexEntry, Project } from '@/types';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import { aliasProblem, readAliases, suggestAliases } from '@/services/codexReference/aliases';
import { findMentions } from '@/services/codexReference/matcher';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
const P = 'synthetic-codex-aliases';

export async function testCodexAliases(): Promise<string[]> {
  const passed: string[] = [];
  // ---- pure ---------------------------------------------------------------------------------
  assert(suggestAliases('Aragorn, hijo de Arathorn', [], { person: true }).join() === 'Aragorn', 'Epithet dropped');
  assert(suggestAliases('Ana Ruiz', [], { person: true }).join() === 'Ana,Ruiz', 'First and last name of a person');
  assert(suggestAliases('Ana Ruiz').length === 0, 'Not for a place or thing');
  assert(suggestAliases('El Bosque Negro').join() === 'Bosque Negro', 'Article dropped');
  assert(suggestAliases('Minas Tirith, la Ciudad Blanca').join() === 'Minas Tirith', 'Before the comma');
  assert(suggestAliases('Ana Ruiz', ['ana'], { person: true }).join() === 'Ruiz', 'Never one already given');
  assert(aliasProblem('El') === 'common' && aliasProblem('the') === 'common' && aliasProblem('x') === 'short' && aliasProblem('Ana Ruiz', 'ana ruiz') === 'title' && aliasProblem('Trancos') === null, 'Problems');
  const mentions = findMentions('El rey volvió. Trancos lo vio y el pueblo calló.', [{ id: 'a', title: 'Aragorn', fields: { aliases: JSON.stringify(['el', 'Trancos']) } }]);
  assert(mentions.length === 1 && mentions[0].count === 1 && mentions[0].matchedAlias === 'Trancos', `A common word never links: ${JSON.stringify(mentions)}`);
  passed.push('Suggestions from the title (the name before an epithet or comma, the title without its article, a person\'s first and last name), a common word, a one-letter name or the title itself refused, and a common word kept on an old card never links text');

  // ---- the card form ---------------------------------------------------------------------------
  useLocaleStore.setState({ locale: 'es' });
  await db.projects.put({ id: P, title: 'Alias', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex'], createdAt: 1, updatedAt: 1 } satisfies Project);
  const entry: CodexEntry = { id: 'codex-aragorn', projectId: P, type: 'character', title: 'Aragorn, hijo de Arathorn', fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 };
  await db.codexEntries.put(entry);
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  let saved: CodexEntry | null = null;
  const render = async (element: ReactNode) => { await act(async () => { root ??= createRoot(host); root.render(<MemoryRouter>{element}</MemoryRouter>); await pause(); }); await act(async () => { await pause(); }); };
  try {
    await render(<CodexEntryForm projectId={P} entry={entry} onSave={async e => { saved = e; }} onCancel={() => undefined} />);
    const suggestion = document.querySelector<HTMLButtonElement>('[data-testid="codex-alias-suggest-Aragorn"]');
    assert(suggestion, `Suggestion shown: ${document.querySelector('[data-testid="codex-alias-suggestions"]')?.textContent}`);
    await act(async () => { suggestion.click(); await pause(); });
    assert(!document.querySelector('[data-testid="codex-alias-suggest-Aragorn"]'), 'Taken suggestions leave the row');
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Añadir otro nombre"]') ?? [...document.querySelectorAll<HTMLInputElement>('input')].find(i => i.getAttribute('aria-describedby')?.endsWith('-hint'));
    assert(input, 'Alias input');
    const type = async (value: string) => {
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(); });
      await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await pause(); });
    };
    await type('el');
    const refused = document.querySelector('[data-testid="codex-alias-refused"]')?.textContent ?? '';
    assert(/«el».*común/.test(refused), `Refused with the reason: ${refused}`);
    await type('Trancos');
    assert(!document.querySelector('[data-testid="codex-alias-refused"]'), 'The message goes with the next good alias');
    const save = [...document.querySelectorAll('button')].find(b => /^(Guardar cambios|Save changes)$/i.test(b.textContent?.trim() ?? ''));
    assert(save, 'Save button');
    await act(async () => { save.click(); await pause(120); });
    assert(saved, 'Saved');
    const got = readAliases((saved as CodexEntry).fields).join();
    assert(got === 'Aragorn,Trancos', `Saved aliases: ${got}`);
    passed.push('Card form: "+ Aragorn" suggested from "Aragorn, hijo de Arathorn" becomes a chip; typing "el" is refused with "«el» es una palabra demasiado común…"; "Trancos" is kept; both are saved with the card');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }

  // ---- the bridge ---------------------------------------------------------------------------------
  try {
    const bad = await runBridgeTool('wh_update_codex_entry', { id: entry.id, aliases: ['Trancos', 'the'] });
    assert(!bad.ok && /too common/.test(bad.error ?? ''), `Refused: ${JSON.stringify(bad)}`);
    const same = await runBridgeTool('wh_create_codex_entry', { projectId: P, title: 'Gandalf', aliases: ['gandalf'] });
    assert(!same.ok && /already the card/.test(same.error ?? ''), `Title refused: ${JSON.stringify(same)}`);
    const ok = await runBridgeTool('wh_update_codex_entry', { id: entry.id, aliases: ['Trancos', 'Elessar'] });
    assert(ok.ok, `Updated: ${JSON.stringify(ok)}`);
    const read = await runBridgeTool('wh_get_codex_entry', { id: entry.id });
    const out = read.result as { aliases: string[]; aliasSuggestions: string[] };
    assert(out.aliases.join() === 'Trancos,Elessar' && out.aliasSuggestions.join() === 'Aragorn', `Read: ${JSON.stringify(out)}`);
    const created = await runBridgeTool('wh_create_codex_entry', { projectId: P, title: 'Ana Ruiz', aliases: ['La Viuda'] });
    const id = (created.result as { id: string }).id;
    const fresh = (await runBridgeTool('wh_get_codex_entry', { id })).result as { aliases: string[]; aliasSuggestions: string[] };
    assert(fresh.aliases.join() === 'La Viuda' && fresh.aliasSuggestions.join() === 'Ana,Ruiz', `Created: ${JSON.stringify(fresh)}`);
    passed.push('Bridge: wh_create_codex_entry and wh_update_codex_entry take aliases (a common word or the title refused with the reason); wh_get_codex_entry gives aliases and aliasSuggestions');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
