import { act, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import '@/engines/codex';
import { useGlobalSearch, type SearchResult } from '@/hooks/useGlobalSearch';
import { searchProjectContent } from '@/services/projectSearchIndex';
import { readAliases } from '@/services/codexReference/aliases';
import { findMentions } from '@/services/codexReference/matcher';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import CodexEntryList from '@/components/codex/CodexEntryList';
import { codexDraftStore } from '@/components/codex/codexDrafts';
import type { CodexEntry } from '@/types';
import { t } from '@/i18n/useTranslation';

const projectId = 'test-vvd-codex-aliases';
const enabled = ['codex'];
const pause = () => new Promise(resolve => setTimeout(resolve, 35));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function testVvdCodexAliases(): Promise<string[]> {
  const host = document.getElementById('root');
  assert(host, 'Missing root');
  const root = createRoot(host);
  const fixture: CodexEntry = {
    id: 'test-vvd-alias-entry', projectId, type: 'character', title: 'Lucía Torres',
    fields: { name: 'Lucía', aliases: '["La Cartógrafa","Torres, Lucía"]', source: 'Unchanged evidence' },
    content: '<p>A travelling surveyor.</p>', tags: [], relations: [], createdAt: 1, updatedAt: 1,
  };
  let saved: CodexEntry | undefined;
  const passed: string[] = [];
  const render = async (content: React.ReactNode) => {
    await act(async () => { root.render(<StrictMode><MemoryRouter>{content}</MemoryRouter></StrictMode>); await pause(); });
    await act(async () => { await pause(); });
  };
  try {
    codexDraftStore(projectId).clear();
    await db.codexEntries.put(fixture);
    await render(<CodexEntryForm projectId={projectId} entry={fixture} onSave={async entry => { saved = entry; await db.codexEntries.put(entry); }} onCancel={() => {}} />);
    const label = [...host.querySelectorAll('label')].find(row => row.textContent === t('codex.aliases'));
    const aliasInput = document.getElementById(label?.htmlFor ?? '') as HTMLInputElement | null;
    assert(aliasInput && aliasInput.getAttribute('aria-describedby'), 'Alias editor has no explicit label or help association');
    assert(host.textContent?.includes('Torres, Lucía') && !host.textContent?.includes('["La Cartógrafa"'), 'Imported aliases are not readable chips');
    await act(async () => {
      aliasInput.focus();
      setInput(aliasInput, 'El Faro');
      await pause();
    });
    await act(async () => { aliasInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(); });
    await act(async () => {
      const save = [...host.querySelectorAll('button')].find(button => button.textContent === t('codex.saveChanges'));
      assert(save, 'Missing Save'); save.click(); await pause();
    });
    assert(saved && readAliases(saved.fields).join('|') === 'La Cartógrafa|Torres, Lucía|El Faro', 'Alias added through the form did not save with imported aliases intact');
    assert(saved.fields.source === fixture.fields.source, 'Alias editing changed non-alias metadata');
    assert(findMentions('El Faro vuelve.', [saved])[0]?.entryId === fixture.id, 'Saved alias is not available to manuscript references');
    passed.push('Codex aliases: explicit accessible editing, JSON imports, persistence and manuscript references');

    await render(<CodexEntryList projectId={projectId} entries={[saved]} onAdd={async () => {}} onEdit={async () => {}} onDelete={async () => {}} />);
    const filter = host.querySelector(`input[placeholder="${t('codex.searchEntries')}"]`) as HTMLInputElement;
    assert(filter, 'Missing Codex search');
    await act(async () => { setInput(filter, 'FARO'); await pause(); });
    assert(host.textContent?.includes(fixture.title) && !host.textContent?.includes(t('codex.noEntries.title')), 'Codex search failed to find the saved alias');
    passed.push('Codex search finds aliases independently of the displayed title');

    function SearchProbe() {
      const { search } = useGlobalSearch(projectId, enabled);
      const [results, setResults] = useState<SearchResult[]>([]);
      return <><button onClick={() => void search('Faro').then(setResults)}>Find alias globally</button><output>{results.map(row => row.title).join('|')}</output></>;
    }
    await render(<SearchProbe />);
    await act(async () => { host.querySelector('button')!.click(); await pause(); await pause(); });
    assert(host.querySelector('output')?.textContent?.includes(fixture.title), 'Global Fuse ranking dropped the alias-only resolver match');
    const content = await searchProjectContent('cartografa', projectId);
    assert(content.some(hit => hit.id === fixture.id && hit.projectId === projectId), 'Advanced project content search omits aliases');
    passed.push('Global and advanced search retain alias-only matches with project scope');

    codexDraftStore(projectId).clear();
    let customSaved: CodexEntry | undefined;
    let cancelled = false;
    await render(<CodexEntryForm key="custom-fields" projectId={projectId} entry={saved} onSave={async entry => { customSaved = entry; await db.codexEntries.put(entry); }} onCancel={() => { cancelled = true; }} />);
    const namedInput = (text: string) => {
      const label = [...host.querySelectorAll('label')].find(row => row.textContent === text);
      const input = document.getElementById(label?.htmlFor ?? '') as HTMLInputElement | null;
      assert(input, `Missing named input: ${text}`);
      return input;
    };
    const addField = async (name: string) => {
      await act(async () => { setInput(namedInput(t('codex.fields.custom')), name); await pause(); });
      await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === t('codex.fields.add'))!.click(); await pause(); });
    };
    await addField(' NAME ');
    assert(host.textContent?.includes(t('codex.fields.nameExists')) && namedInput(t('codex.field.name')).value === 'Lucía', 'Custom field name overwrote an existing template field');
    await addField('aliases');
    assert(host.textContent?.includes(t('codex.fields.nameReserved')), 'Custom fields can overwrite the alias editor');
    await addField('__proto__');
    assert(host.textContent?.includes(t('codex.fields.nameReserved')), 'Unsafe prototype field name accepted');
    await addField('Energía vital 能量');
    await act(async () => { setInput(namedInput('Energía vital 能量'), 'Luz de luna 月光'); setInput(namedInput('source'), 'Updated evidence'); await pause(); });
    await addField('energia VITAL 能量');
    assert(host.textContent?.includes(t('codex.fields.nameExists')), 'Unicode/accent-folded duplicate field name accepted');
    const removeSource = host.querySelector(`button[aria-label="${t('codex.fields.remove').replace('{name}', 'source')}"]`) as HTMLButtonElement;
    assert(removeSource, 'Imported custom fields have no removal action');
    await act(async () => { removeSource.click(); await pause(); });
    const confirm = document.querySelector('[role="alertdialog"]') ?? document.querySelector('[role="dialog"]');
    assert(confirm?.textContent?.includes(t('codex.fields.removeTitle')), 'Populated field removal did not ask explicitly');
    await act(async () => { [...confirm.querySelectorAll('button')].find(button => button.textContent === t('common.cancel'))!.click(); await pause(); });
    assert(namedInput('source').value === 'Updated evidence', 'Cancelling removal discarded imported field content');
    await addField('Temporary field');
    await act(async () => { setInput(namedInput('Temporary field'), 'Temporary value'); await pause(); });
    await act(async () => { (host.querySelector(`button[aria-label="${t('codex.fields.remove').replace('{name}', 'Temporary field')}"]`) as HTMLButtonElement).click(); await pause(); });
    const removal = document.querySelector('[role="alertdialog"]') ?? document.querySelector('[role="dialog"]');
    assert(removal, 'Missing field-removal dialog');
    await act(async () => { [...removal.querySelectorAll('button')].find(button => button.textContent === t('common.remove'))!.click(); await pause(); });
    assert(![...host.querySelectorAll('label')].some(label => label.textContent === 'Temporary field'), 'Confirmed field removal left the field visible');
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === t('codex.saveChanges'))!.click(); await pause(); });
    assert(customSaved?.fields['Energía vital 能量'] === 'Luz de luna 月光' && customSaved.fields.source === 'Updated evidence' && customSaved.fields.name === 'Lucía' && !('Temporary field' in customSaved.fields), 'Custom fields were not saved alongside existing metadata/removal');
    passed.push('Custom Codex fields: Unicode names/values, built-in collisions, reserved keys, imported edits and safe removal cancellation');

    await render(<CodexEntryForm key="cancel-custom" projectId={projectId} entry={customSaved} onSave={async () => { throw new Error('Cancel unexpectedly saved'); }} onCancel={() => { cancelled = true; }} />);
    await act(async () => { setInput(namedInput('Energía vital 能量'), 'Unsaved alternative'); await pause(); });
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === t('common.cancel'))!.click(); await pause(); });
    assert(cancelled && (await db.codexEntries.get(fixture.id))?.fields['Energía vital 能量'] === 'Luz de luna 月光', 'Cancel persisted unsaved custom fields');
    assert(codexDraftStore(projectId).get(fixture.id)?.fields['Energía vital 能量'] === 'Unsaved alternative', 'Cancel lost the recoverable custom-field draft');
    passed.push('Custom fields: save persists, cancel keeps saved data and retains a recoverable draft');
    return passed;
  } finally {
    await act(async () => { root.unmount(); await pause(); });
    await db.codexEntries.where('projectId').equals(projectId).delete();
    codexDraftStore(projectId).clear();
  }
}
