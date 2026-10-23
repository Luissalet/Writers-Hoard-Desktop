import { useEraNavigate } from '@/services/worldEras/navigation';
import { bindEraOperation, useWorldEraScope, useEraProject, useEraRows } from '@/services/worldEras/hooks';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BookMarked, ClipboardList, Download, Languages, Plus, Search, Settings2, Trash2, Upload } from 'lucide-react';
import { saveAs } from 'file-saver';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import ConfirmDialog from '@/engines/_shared/components/ConfirmDialog';
import { useDeepLinkParam } from '@/engines/_shared';
import { dictionaryCopy } from './copy';
import { DICTIONARY_COLORS, emptyWord, exportDictionary, homographNumbers, nativeWord, parseDictionaryImport, parseWordList, searchWords, SENSES_MAX, type DictionaryWord, type WorldDictionary } from './types';
import { importWords as importWordsScoped, removeDictionary as removeDictionaryScoped, removeWord as removeWordScoped, saveDictionary as saveDictionaryScoped, saveWord as saveWordScoped } from './operations';
import { dictionaryDrafts, useDictionaryDraft } from './drafts';
import { DictionaryScriptSettings } from './DictionaryScriptSettings';
import { useDictionaryFont } from './useDictionaryFont';
import { scriptCopy } from './scriptCopy';
import { useEnginePane } from '@/engines/_shared/EnginePaneContext';

const input = 'w-full min-w-0 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold';
const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:cursor-not-allowed disabled:opacity-50';
const primaryButton = `${button.replace('text-text-primary', 'text-deep').replace('hover:bg-elevated', 'hover:brightness-110')} bg-accent-gold`;
type Copy = typeof dictionaryCopy.en;

function LanguageForm({ projectId, existing, initial, copy, busy, onSave, onCancel }: { projectId: string; existing: boolean; initial: WorldDictionary; copy: Copy; busy: boolean; onSave: (dictionary: WorldDictionary, base: WorldDictionary | undefined, clear: () => void) => void; onCancel: () => void }) {
  const { draft, setDraft, base, clear, recovered } = useDictionaryDraft(projectId, 'language', initial, existing);
  const { locale } = useTranslation();
  const [fontBusy, setFontBusy] = useState(false);
  return <form className="space-y-4 p-5" onSubmit={event => { event.preventDefault(); if (!fontBusy) onSave(draft, base, clear); }}>
    <h3 className="font-display text-xl text-text-primary">{copy.editLanguage}</h3>
    {recovered && <p role="status" className="text-sm text-accent-gold">{copy.recovered}</p>}
    <fieldset disabled={busy} className="space-y-4">
      <label className="block space-y-1 text-sm text-text-primary">{copy.name}<input required autoFocus maxLength={300} className={input} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className="block space-y-1 text-sm text-text-primary">{copy.description}<textarea className={input} rows={2} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      <div className="space-y-1 text-sm text-text-primary"><span>{copy.bookColor}</span><div className="flex flex-wrap items-center gap-1.5">{DICTIONARY_COLORS.map(color => <button key={color} type="button" data-testid={`dictionary-color-${color.slice(1)}`} aria-label={color} aria-pressed={draft.color === color} onClick={() => setDraft({ ...draft, color })} className={`h-7 w-7 rounded-full border-2 ${draft.color === color ? 'border-text-primary' : 'border-transparent'}`} style={{ background: color }} />)}{draft.color && <button type="button" className="text-xs text-text-muted underline" onClick={() => setDraft({ ...draft, color: undefined })}>{copy.noColor}</button>}</div></div>
      <DictionaryScriptSettings dictionary={draft} locale={locale} onMapping={scriptMapping => setDraft(current => ({ ...current, scriptMapping }))} onFont={font => setDraft(current => ({ ...current, font }))} onBusy={setFontBusy} />
      <label className="block space-y-1 text-sm text-text-primary">{copy.mapping}<textarea className={`${input} font-mono`} rows={5} value={draft.scriptMapping} onChange={e => setDraft({ ...draft, scriptMapping: e.target.value })} /></label>
      <p className="max-w-prose text-sm text-text-muted">{copy.mappingHelp}</p>
      <label className="flex items-start gap-2 text-sm text-text-primary"><input type="checkbox" className="mt-1 accent-accent-gold" checked={draft.detectInManuscript} onChange={e => setDraft({ ...draft, detectInManuscript: e.target.checked })} />{copy.detection}</label>
      <p className="max-w-prose text-sm text-text-muted">{copy.detectionHelp}</p>
      <label className="flex items-start gap-2 text-sm text-text-primary"><input type="checkbox" data-testid="dictionary-show-native" className="mt-1 accent-accent-gold" disabled={!draft.detectInManuscript} checked={!!draft.showNativeInProse} onChange={e => setDraft({ ...draft, showNativeInProse: e.target.checked })} />{copy.showNative}</label>
      <div className="flex flex-wrap gap-2"><button className={primaryButton} type="submit" disabled={fontBusy}>{copy.save}</button><button className={button} type="button" disabled={fontBusy} onClick={onCancel}>{copy.cancel}</button><button className={button} type="button" disabled={fontBusy} onClick={() => { clear(); onCancel(); }}>{copy.discardDraft}</button></div>
    </fieldset>
  </form>;
}

export function WordForm({ projectId, initial, dictionary, copy, busy, entries, onSave, onCancel }: { projectId: string; initial: DictionaryWord; dictionary: WorldDictionary; copy: Copy; busy: boolean; entries: { id: string; title: string }[]; onSave: (word: DictionaryWord, base: DictionaryWord | undefined, clear: () => void) => void; onCancel: () => void }) {
  const { draft, setDraft, base, clear, recovered } = useDictionaryDraft(projectId, 'word', initial, dictionary.words.some(word => word.id === initial.id), dictionary.id);
  const { fontFamily } = useDictionaryFont(dictionary.font);
  const fields = ['word', 'nativeForm', 'pronunciation', 'partOfSpeech', 'meaning', 'examples', 'phrases', 'derivatives', 'origin'] as const;
  return <form className="space-y-4 p-5" onSubmit={(event: FormEvent) => { event.preventDefault(); onSave(draft, base, clear); }}>
    <h3 className="font-display text-xl text-text-primary">{copy.editWord}</h3>
    {recovered && <p role="status" className="text-sm text-accent-gold">{copy.recovered}</p>}
    <fieldset disabled={busy} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {fields.map(field => <label key={field} className={`block space-y-1 text-sm text-text-primary ${['meaning', 'examples', 'phrases', 'derivatives', 'origin'].includes(field) ? 'lg:col-span-2' : ''}`}>{copy[field]}
        {['meaning', 'examples', 'phrases', 'derivatives', 'origin'].includes(field)
          ? <textarea required={field === 'meaning'} maxLength={50000} className={input} rows={field === 'meaning' ? 3 : 2} value={draft[field]} onChange={e => setDraft({ ...draft, [field]: e.target.value })} />
          : <input required={field === 'word'} autoFocus={field === 'word'} maxLength={50000} className={input} style={field === 'nativeForm' ? { fontFamily } : undefined} value={draft[field]} onChange={e => setDraft({ ...draft, [field]: e.target.value })} />}
      </label>)}
      <output className="break-words text-lg text-accent-gold lg:col-span-2" style={{ fontFamily }}>{nativeWord(draft, dictionary.scriptMapping)}</output>
      <fieldset className="space-y-2 lg:col-span-2" data-testid="dictionary-senses">
        <legend className="text-sm text-text-primary">{copy.senses}</legend>
        <p className="text-xs text-text-muted">{copy.sensesHelp}</p>
        {(draft.senses ?? []).map((sense, index) => <div key={index} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-2 sm:grid-cols-[8rem_1fr_auto]" data-testid={`dictionary-sense-${index}`}>
          <input aria-label={`${copy.partOfSpeech} ${index + 2}`} placeholder={copy.partOfSpeech} maxLength={300} className={input} value={sense.partOfSpeech} onChange={e => setDraft({ ...draft, senses: (draft.senses ?? []).map((other, i) => i === index ? { ...other, partOfSpeech: e.target.value } : other) })} />
          <textarea aria-label={`${copy.meaning} ${index + 2}`} placeholder={copy.meaning} maxLength={50000} rows={2} className={input} value={sense.meaning} onChange={e => setDraft({ ...draft, senses: (draft.senses ?? []).map((other, i) => i === index ? { ...other, meaning: e.target.value } : other) })} />
          <button type="button" className={button} aria-label={`${copy.removeSense} ${index + 2}`} onClick={() => setDraft({ ...draft, senses: (draft.senses ?? []).filter((_, i) => i !== index) })}><Trash2 size={14} /></button>
          <textarea aria-label={`${copy.examples} ${index + 2}`} placeholder={copy.examples} maxLength={50000} rows={1} className={`${input} sm:col-span-3`} value={sense.examples} onChange={e => setDraft({ ...draft, senses: (draft.senses ?? []).map((other, i) => i === index ? { ...other, examples: e.target.value } : other) })} />
        </div>)}
        {(draft.senses?.length ?? 0) < SENSES_MAX && <button type="button" className={button} data-testid="dictionary-sense-add" onClick={() => setDraft({ ...draft, senses: [...(draft.senses ?? []), { partOfSpeech: '', meaning: '', examples: '' }] })}><Plus size={14} />{copy.addSense}</button>}
      </fieldset>
      <label className="block space-y-1 text-sm text-text-primary lg:col-span-2">{copy.seeAlso}
        <input className={input} data-testid="dictionary-see-also" maxLength={5000} placeholder={copy.seeAlsoPlaceholder} value={(draft.seeAlso ?? []).join(', ')}
          onChange={e => setDraft({ ...draft, seeAlso: e.target.value.split(',').map(word => word.trimStart()) })} />
      </label>
      <label className="block space-y-1 text-sm text-text-primary lg:col-span-2">{copy.linkedEntryId}<select className={input} value={draft.linkedEntryId ?? ''} onChange={e => setDraft({ ...draft, linkedEntryId: e.target.value || undefined })}><option value="">{copy.noEntry}</option>{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>
      <div className="flex flex-wrap gap-2 lg:col-span-2"><button className={primaryButton} type="submit">{copy.save}</button><button className={button} type="button" onClick={onCancel}>{copy.cancel}</button><button className={button} type="button" onClick={() => { clear(); onCancel(); }}>{copy.discardDraft}</button></div>
    </fieldset>
  </form>;
}

export default function DictionaryEngine({ projectId }: EngineComponentProps) {
  const pane = useEnginePane();
  const reportPaneTitle = pane?.reportTitle;
  const { locale } = useTranslation();
  const copy = dictionaryCopy[locale];
  const navigate = useEraNavigate();
  const scope = useWorldEraScope(projectId);
  const saveDictionary = bindEraOperation(saveDictionaryScoped, scope.eraId, 3);
  const removeDictionary = bindEraOperation(removeDictionaryScoped, scope.eraId, 2);
  const saveWord = bindEraOperation(saveWordScoped, scope.eraId, 4);
  const removeWord = bindEraOperation(removeWordScoped, scope.eraId, 3);
  const project = useEraProject(projectId);
  const entries = useEraRows<import('@/types').CodexEntry>('codexEntries', projectId);
  const deepLink = useDeepLinkParam('entity');
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [languageDraft, setLanguageDraft] = useState<WorldDictionary | null>(null);
  const [wordDraft, setWordDraft] = useState<DictionaryWord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<'language' | DictionaryWord | null>(null);
  const [appliedLink, setAppliedLink] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  /** The "paste a list" box: null when closed, the text pasted so far when open. */
  const [pasting, setPasting] = useState<string | null>(null);
  const dictionaries = project?.dictionaries ?? [];
  const recoveries = [...dictionaryDrafts(projectId, scope.eraId).values()].filter(row => row.kind === 'language' || dictionaries.some(dictionary => dictionary.id === row.dictionaryId));
  if(deepLink&&deepLink!==appliedLink&&dictionaries.some(dictionary=>dictionary.id===deepLink)){setSelectedId(deepLink);setQuery('');setAppliedLink(deepLink);}
  if (deepLink && deepLink !== appliedLink && dictionaries.some(dictionary => dictionary.words.some(word => word.id === deepLink))) {
    const dictionary = dictionaries.find(dictionary => dictionary.words.some(word => word.id === deepLink))!;
    setSelectedId(dictionary.id); setQuery(dictionary.words.find(word => word.id === deepLink)!.word); setAppliedLink(deepLink);
  }
  const dictionary = dictionaries.find(item => item.id === selectedId) ?? dictionaries[0];
  const homographs = homographNumbers(dictionary?.words ?? []);
  useEffect(() => { reportPaneTitle?.(dictionary?.name); }, [dictionary?.name, reportPaneTitle]);
  const { fontFamily, error: fontError } = useDictionaryFont(dictionary?.font);
  const locked = Boolean(languageDraft || wordDraft || busy);
  const run = async (work: () => Promise<void>, success?: () => void) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); success?.(); } catch { setError(copy.error); } finally { setBusy(false); }
  };

  if (!project) return <p className="p-5 text-text-muted">{copy.loading}</p>;
  return <section className="flex h-full min-h-0 flex-col bg-deep" aria-label={copy.title}>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
      <div className="min-w-0"><h2 className="flex items-center gap-2 font-display text-2xl text-text-primary"><Languages size={24} aria-hidden="true" />{copy.title}</h2><p className="mt-2 max-w-prose text-sm text-text-muted">{copy.intro}</p></div>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={locked} onClick={() => { setError(''); setLanguageDraft({ id: crypto.randomUUID(), name: '', description: '', scriptMapping: '', detectInManuscript: false, words: [] }); }}><Plus size={16} />{copy.newLanguage}</button>
        <button className={button} disabled={locked} onClick={() => importRef.current?.click()}><Upload size={16} />{copy.import}</button>
        <input ref={importRef} type="file" accept=".json,application/json" className="hidden" aria-label={copy.import} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; void run(async () => { if (file.size > 8_000_000) throw new Error('Too large'); let imported: WorldDictionary; try { imported = parseDictionaryImport(await file.text()); } catch { setError(copy.importError); return; } await saveDictionary(projectId, imported); setSelectedId(imported.id); }); }} />
      </div>
    </header>
    {error && <p role="alert" className="border-b border-border p-4 text-sm text-danger">{error}</p>}
    {!locked && recoveries.length > 0 && <details className="border-b border-border p-4"><summary className="cursor-pointer text-sm text-accent-gold">{copy.recover} · {recoveries.length}</summary><div className="mt-3 flex flex-wrap gap-2">{recoveries.map(row => <button key={`${row.kind}:${row.value.id}`} className={button} onClick={() => { if (row.kind === 'language') setLanguageDraft(row.base as WorldDictionary); else { setSelectedId(row.dictionaryId!); setWordDraft(row.base as DictionaryWord); } }}>{row.kind === 'language' ? (row.value as WorldDictionary).name || copy.newLanguage : (row.value as DictionaryWord).word || copy.newWord}</button>)}</div></details>}
    <div className="flex min-h-0 flex-1 flex-col overflow-auto md:flex-row">
      <nav aria-label={copy.title} className="shrink-0 border-b border-border p-3 md:w-56 md:overflow-y-auto md:border-r md:border-b-0">
        {dictionaries.length === 0 && <p className="p-2 text-sm text-text-muted">{copy.emptyLanguages}</p>}
        {dictionaries.map(item => <button key={item.id} disabled={locked} aria-current={item.id === dictionary?.id ? 'page' : undefined} className={`mb-1 flex w-full items-center justify-between gap-2 break-all rounded-lg p-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50 ${item.id === dictionary?.id ? 'bg-elevated text-accent-gold' : 'text-text-primary hover:bg-surface'}`} onClick={() => { setSelectedId(item.id); setQuery(''); }}><span className="flex min-w-0 items-center gap-2"><BookMarked size={16} aria-hidden="true" data-testid={`dictionary-book-${item.id}`} style={{ color: item.color ?? 'currentColor' }} className="shrink-0" />{item.name}</span><span className="shrink-0 tabular-nums text-text-muted">{item.words.length}</span></button>)}
      </nav>
      <div className="min-w-0 flex-1 md:overflow-y-auto">
        {languageDraft ? <LanguageForm projectId={projectId} existing={dictionaries.some(item => item.id === languageDraft.id)} key={languageDraft.id} initial={languageDraft} copy={copy} busy={busy} onCancel={() => { setLanguageDraft(null); setError(''); }} onSave={(draft, base, clear) => { void run(() => saveDictionary(projectId, draft, base), () => { clear(); setSelectedId(draft.id); setLanguageDraft(null); }); }} />
          : dictionary && wordDraft ? <WordForm projectId={projectId} key={wordDraft.id} initial={wordDraft} dictionary={dictionary} copy={copy} busy={busy} entries={entries} onCancel={() => { setWordDraft(null); setError(''); }} onSave={(word, base, clear) => { void run(() => saveWord(projectId, dictionary.id, word, base), () => { clear(); setWordDraft(null); }); }} />
            : dictionary && <>
              <div className="flex flex-wrap items-start justify-between gap-3 p-5"><div className="min-w-0"><h3 className="break-words font-display text-xl text-text-primary">{dictionary.name}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-muted">{dictionary.description}</p></div><div className="flex flex-wrap gap-2">
                <button className={button} disabled={busy} onClick={() => setWordDraft(emptyWord())}><Plus size={16} />{copy.newWord}</button>
                <button className={button} disabled={busy} data-testid="dictionary-paste-open" onClick={() => setPasting(pasting === null ? '' : null)}><ClipboardList size={16} />{copy.pasteList}</button>
                <button className={button} disabled={busy} onClick={() => setLanguageDraft(structuredClone(dictionary))} aria-label={copy.editLanguage}><Settings2 size={16} /></button>
                <button className={button} disabled={busy} onClick={() => saveAs(new Blob([exportDictionary(dictionary)], { type: 'application/json;charset=utf-8' }), `${dictionary.name.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'dictionary'}.json`)}><Download size={16} />{copy.export}</button>
                <button className={button} disabled={busy} onClick={() => setConfirmation('language')} aria-label={`${copy.remove} ${dictionary.name}`}><Trash2 size={16} /></button>
              </div></div>
              {pasting !== null && (() => {
                const parsed = parseWordList(pasting);
                const key = (w: string, m: string) => `${w.normalize('NFC').trim().toLocaleLowerCase()}\u0000${m.trim().toLocaleLowerCase()}`;
                const have = new Set(dictionary.words.map(word => key(word.word, word.meaning)));
                const fresh = new Set<string>(); let newCount = 0;
                for (const row of parsed.words) { const k = key(row.word, row.meaning); if (!have.has(k) && !fresh.has(k)) { fresh.add(k); newCount++; } }
                return <div className="mx-5 mb-4 space-y-2 rounded-lg border border-border p-3" data-testid="dictionary-paste">
                  <p className="text-sm text-text-muted">{copy.pasteHelp}</p>
                  <textarea className={`${input} font-mono`} rows={6} maxLength={2_000_000} aria-label={copy.pasteList} data-testid="dictionary-paste-text" value={pasting} onChange={e => setPasting(e.target.value)} />
                  <p className="text-sm text-text-primary" role="status" data-testid="dictionary-paste-preview">{copy.pastePreview.replace('{new}', String(newCount)).replace('{skip}', String(parsed.words.length - newCount)).replace('{bad}', String(parsed.invalid.length))}{parsed.invalid.length ? ` (${copy.pasteLines} ${parsed.invalid.slice(0, 8).join(', ')}${parsed.invalid.length > 8 ? '…' : ''})` : ''}</p>
                  <div className="flex flex-wrap gap-2">
                    <button className={primaryButton} disabled={busy || !newCount} data-testid="dictionary-paste-import" onClick={() => void run(async () => { await importWordsScoped(projectId, dictionary.id, parsed.words, scope.eraId); }, () => setPasting(null))}>{copy.pasteImport.replace('{n}', String(newCount))}</button>
                    <button className={button} disabled={busy} onClick={() => setPasting(null)}>{copy.cancel}</button>
                  </div>
                </div>;
              })()}
              {fontError && <p role="alert" className="px-5 pb-3 text-sm text-danger">{scriptCopy[locale].fontLoadError}</p>}
              <div className="relative mx-5 mb-4"><Search className="pointer-events-none absolute top-3 left-3 text-text-muted" size={16} /><input className={`${input} pl-9`} aria-label={copy.search} placeholder={copy.search} value={query} onChange={event => setQuery(event.target.value)} /></div>
              {searchWords(dictionary, query).length === 0 && <p className="p-5 text-sm text-text-muted">{dictionary.words.length ? copy.noResults : copy.emptyWords}</p>}
              <dl className="divide-y divide-border px-5">{searchWords(dictionary, query).map(word => <div key={word.id} className="py-5" data-word-id={word.id}>
                <dt className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><button className="break-words text-left font-display text-xl text-accent-gold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent-gold" onClick={() => setWordDraft(structuredClone(word))}>{word.word}{homographs.get(word.id) ? <sup className="ml-0.5 text-sm" data-testid="dictionary-homograph">{homographs.get(word.id)}</sup> : null}</button><span className="ml-3 break-words text-lg text-text-primary" data-testid="dictionary-native-word" style={{ fontFamily }}>{nativeWord(word, dictionary.scriptMapping) !== word.word || dictionary.font ? nativeWord(word, dictionary.scriptMapping) : ''}</span><p className="mt-1 text-sm text-text-muted">{[word.pronunciation, word.partOfSpeech].filter(Boolean).join(' · ')}</p></div><button className={button} disabled={busy} aria-label={`${copy.remove} ${word.word}`} onClick={() => setConfirmation(word)}><Trash2 size={15} /></button></dt>
                <dd className="mt-3 max-w-prose space-y-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-primary"><p>{word.senses?.length ? <span className="mr-1 font-semibold text-text-muted">1.</span> : null}{word.meaning}</p>{word.senses?.map((sense, index) => <p key={index} data-testid="dictionary-word-sense"><span className="mr-1 font-semibold text-text-muted">{index + 2}.</span>{sense.partOfSpeech && <em className="mr-1 text-text-muted">{sense.partOfSpeech}</em>}{sense.meaning}{sense.examples && <span className="block text-text-muted">{sense.examples}</span>}</p>)}{word.seeAlso?.length ? <p data-testid="dictionary-see-also-list"><span className="font-semibold text-text-muted">{copy.seeAlso}: </span>{word.seeAlso.map((other, index) => <span key={other}>{index ? ', ' : ''}<button className="text-accent-gold underline underline-offset-4" onClick={() => setQuery(other)}>{other}</button></span>)}</p> : null}{(['examples', 'phrases', 'derivatives', 'origin'] as const).map(field => word[field] && <p key={field}><span className="font-semibold text-text-muted">{copy[field]}: </span>{word[field]}</p>)}{word.linkedEntryId && entries.some(entry => entry.id === word.linkedEntryId) && <button className="text-accent-gold underline underline-offset-4" onClick={() => navigate(`/project/${encodeURIComponent(projectId)}/codex?entry=${encodeURIComponent(word.linkedEntryId!)}`)}>{entries.find(entry => entry.id === word.linkedEntryId)?.title}</button>}</dd>
              </div>)}</dl>
            </>}
      </div>
    </div>
    <ConfirmDialog open={Boolean(confirmation)} destructive message={confirmation === 'language' ? copy.confirmLanguage : copy.confirmWord} onCancel={() => setConfirmation(null)} onConfirm={async () => { if (!dictionary || !confirmation) return; await run(() => confirmation === 'language' ? removeDictionary(projectId, dictionary.id) : removeWord(projectId, dictionary.id, confirmation.id), () => setConfirmation(null)); }} />
  </section>;
}
