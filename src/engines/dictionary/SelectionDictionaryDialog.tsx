import { useState } from 'react';
import Modal from '@/components/common/Modal';
import { useTranslation } from '@/i18n/useTranslation';
import { useEraProject, useEraRows } from '@/services/worldEras/hooks';
import { usePaneNavigate } from '@/engines/_shared/usePaneNavigate';
import { WordForm } from './DictionaryEngine';
import { dictionaryCopy } from './copy';
import { emptyWord, searchWords, nativeWord, type DictionaryWord } from './types';
import { saveWord } from './operations';
import type { CodexEntry } from '@/types';
const button = 'min-h-9 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated disabled:opacity-40';
export default function SelectionDictionaryDialog({ projectId, eraId, selection, onClose }: { projectId: string; eraId?: string; selection: string; onClose: () => void }) {
  const { locale } = useTranslation(), es = locale === 'es', copy = dictionaryCopy[locale], project = useEraProject(projectId), entries = useEraRows<CodexEntry>('codexEntries', projectId), navigate = usePaneNavigate();
  const [query, setQuery] = useState(selection), [dictionaryId, setDictionaryId] = useState(''), [draft, setDraft] = useState<DictionaryWord>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dictionaries = project?.dictionaries ?? [], dictionary = dictionaries.find(item => item.id === dictionaryId) ?? dictionaries[0];
  const results = dictionaries.flatMap(language => searchWords(language, query).map(word => ({ language, word })));
  const open = (id?: string) => { const query = new URLSearchParams({ era: eraId ?? '' }); if (id) query.set('entity', id); void navigate(`/project/${encodeURIComponent(projectId)}/dictionary?${query}`); onClose(); };
  return <Modal open title={es ? 'Diccionario de la selección' : 'Selection dictionary'} onClose={() => { if (!busy) onClose(); }} dismissible={!busy}>
    <div data-testid="selection-dictionary" className="space-y-4">
      {draft && dictionary ? <WordForm key={`${dictionary.id}:${draft.id}`} projectId={projectId} initial={draft} dictionary={dictionary} copy={copy} busy={busy} entries={entries} onCancel={() => setDraft(undefined)} onSave={(word, base, clear) => {
        if (busy) return; setBusy(true); setError(''); void saveWord(projectId, dictionary.id, word, base, eraId).then(() => { clear(); setDraft(undefined); setQuery(word.word); }).catch(() => setError(copy.error)).finally(() => setBusy(false));
      }} /> : <>
        <label className="block space-y-1 text-sm text-text-muted">{copy.search}<input autoFocus aria-label={es ? 'Buscar la selección' : 'Search selection'} className="min-h-10 w-full rounded-lg border border-border bg-elevated px-3 py-2 text-text-primary" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {!!dictionary && <div className="flex flex-wrap items-center gap-2"><label className="min-w-40 flex-1 text-sm text-text-muted">{es ? 'Idioma de destino' : 'Target language'}<select aria-label={es ? 'Idioma de destino' : 'Target language'} className="mt-1 min-h-10 w-full rounded-lg border border-border bg-elevated px-3 text-text-primary" value={dictionary.id} onChange={event => setDictionaryId(event.target.value)}>{dictionaries.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className={button} disabled={!query.trim()} onClick={() => { setError(''); setDraft({ ...emptyWord(), word: query.trim() }); }}>{copy.newWord}</button></div>}
        <ul className="max-h-72 divide-y divide-border overflow-auto">{results.map(({ language, word }) => <li key={`${language.id}:${word.id}`} className="space-y-2 py-3"><div className="flex flex-wrap items-center gap-2"><strong className="break-words text-text-primary">{word.word}</strong><span className="text-sm text-text-muted">{nativeWord(word, language.scriptMapping)} · {language.name}</span></div><p className="whitespace-pre-wrap break-words text-sm text-text-primary">{word.meaning}</p><div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => open(word.id)}>{es ? 'Abrir palabra' : 'Open word'}</button><button type="button" className={button} onClick={() => { setDictionaryId(language.id); setDraft(word); }}>{copy.editWord}</button></div></li>)}</ul>
        {!results.length && <p className="text-sm text-text-muted">{dictionaries.length ? copy.noResults : copy.emptyLanguages}</p>}
        <button type="button" className={button} onClick={() => open()}>{es ? 'Abrir diccionarios' : 'Open dictionaries'}</button>
      </>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  </Modal>;
}
