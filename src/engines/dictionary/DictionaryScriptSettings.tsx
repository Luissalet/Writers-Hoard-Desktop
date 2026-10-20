import { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import type { WorldDictionary } from './types';
import { nativeWord } from './types';
import { presetMapping, scriptPresets } from './scripts';
import { readDictionaryFont, type DictionaryFont } from './fonts';
import { useDictionaryFont } from './useDictionaryFont';
import { scriptCopy } from './scriptCopy';

const input = 'w-full min-w-0 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold';
const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:cursor-not-allowed disabled:opacity-50';

export function DictionaryScriptSettings({ dictionary, locale, onMapping, onFont, onBusy }: { dictionary: WorldDictionary; locale: 'en' | 'es'; onMapping: (mapping: string) => void; onFont: (font: DictionaryFont | undefined) => void; onBusy: (busy: boolean) => void }) {
  const copy = scriptCopy[locale];
  const [preset, setPreset] = useState('');
  const [sample, setSample] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const { fontFamily, error: loadError } = useDictionaryFont(dictionary.font);
  return <section className="space-y-3 rounded-lg border border-border bg-surface p-4" aria-label={copy.preset}>
    <div className="flex flex-wrap items-end gap-2">
      <label className="block min-w-48 flex-1 space-y-1 text-sm text-text-primary">{copy.preset}<select data-testid="dictionary-script-preset" className={input} value={preset} onChange={event => setPreset(event.target.value)}><option value="">{copy.custom}</option>{scriptPresets.map(item => <option key={item.id} value={item.id}>{item.id === 'runic' ? copy.runes : item.name}</option>)}</select></label>
      <button type="button" data-testid="dictionary-script-apply" className={button} disabled={!preset} onClick={() => { const mapping = presetMapping(preset); if (mapping !== undefined) onMapping(mapping); }}>{copy.apply}</button>
    </div>
    <p className="max-w-prose text-sm text-text-muted">{copy.presetHelp}</p>
    <div className="border-t border-border pt-3">
      <p className="mb-2 text-sm font-semibold text-text-primary">{copy.font}</p>
      <div className="flex flex-wrap items-center gap-2"><button type="button" className={button} disabled={busy} onClick={() => upload.current?.click()}><Upload size={15} aria-hidden="true" />{busy ? copy.loading : copy.upload}</button>
        {dictionary.font && <><span className="break-all text-sm text-text-primary" data-testid="dictionary-font-name">{dictionary.font.name}</span><button type="button" data-testid="dictionary-font-remove" className={button} disabled={busy} onClick={() => { onFont(undefined); setError(false); }}><X size={15} aria-hidden="true" />{copy.remove}</button></>}
      </div>
      <input ref={upload} type="file" className="hidden" accept=".ttf,.otf,.woff,.woff2" aria-label={copy.upload} data-testid="dictionary-font-upload" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        setBusy(true); onBusy(true); setError(false);
        void readDictionaryFont(file).then(onFont).catch(() => setError(true)).finally(() => { setBusy(false); onBusy(false); });
      }} />
      <p className="mt-2 max-w-prose text-sm text-text-muted">{copy.fontHelp}</p>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{copy.fontError}</p>}
      {loadError && <p role="alert" className="mt-2 text-sm text-danger">{copy.fontLoadError}</p>}
    </div>
    <label className="block space-y-1 text-sm text-text-primary">{copy.sampleLabel}<input className={input} data-testid="dictionary-script-sample" maxLength={300} value={sample} placeholder={copy.sample} onChange={event => setSample(event.target.value)} /></label>
    <output data-testid="dictionary-script-preview" aria-label={copy.preview} className="block break-words rounded-lg bg-deep p-4 text-2xl leading-relaxed text-accent-gold" style={{ fontFamily }}>{nativeWord({ word: sample || copy.sample, nativeForm: '' }, dictionary.scriptMapping)}</output>
  </section>;
}
