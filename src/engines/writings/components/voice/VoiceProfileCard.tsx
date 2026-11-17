import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Sparkles, Undo2 } from 'lucide-react';
import { db } from '@/db';
import { useTranslation } from '@/i18n/useTranslation';
import type { VoiceProfile } from '@/engines/writings/voice/profile';
import { describeVoice, type VoiceReport } from '@/services/voice/report';
import { revertVoiceDescription, setVoiceDescription, type VoiceReceipt } from '@/services/voice/ops';

import { fillVoice, voiceButton } from './voiceUi';

const field = 'w-full rounded-md border border-border bg-elevated px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-gold';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
      <dt className="text-text-dim">{label}</dt>
      <dd className="break-words text-text-primary">{value || '—'}</dd>
    </div>
  );
}

/** One character's voice: the computed profile and the description kept on their card. */
export default function VoiceProfileCard({ report, profile, projectId }: { report: VoiceReport; profile: VoiceProfile; projectId: string }) {
  const { t, locale } = useTranslation();
  const card = useLiveQuery(() => db.codexEntries.get(profile.characterId), [profile.characterId]);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [undo, setUndo] = useState<VoiceReceipt | null>(null);
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const address = (['tu', 'usted', 'vos'] as const).filter((k) => profile.address[k] > 0).map((k) => `${t(`charVoice.address.${k}`)} ${profile.address[k]}`).join(' · ');
  const save = async (text: string | null, model?: string) => {
    setFailure(null);
    try { setUndo(await setVoiceDescription(projectId, profile.characterId, text, model)); setDraft(null); }
    catch (e) { setFailure(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="space-y-2" data-testid="voice-profile">
      <dl className="space-y-1 rounded-lg bg-deep p-2 text-[11px]">
        <Stat label={t('charVoice.lines')} value={fillVoice(t('charVoice.linesValue'), { lines: profile.lines, words: profile.words })} />
        <Stat label={t('charVoice.sentence')} value={fillVoice(t('charVoice.sentenceValue'), { mean: profile.sentenceMean.toLocaleString(locale), sd: profile.sentenceSd.toLocaleString(locale) })} />
        <Stat label={t('charVoice.marks')} value={fillVoice(t('charVoice.marksValue'), { ex: pct(profile.exclamations), q: pct(profile.questions), dots: pct(profile.ellipses) })} />
        <Stat label={t('charVoice.address')} value={address ? `${address}${profile.addressForm ? ` (${t(`charVoice.address.${profile.addressForm}`)})` : ''}` : ''} />
        <Stat label={t('charVoice.register')} value={`${t(`charVoice.register.${profile.register}`)} · ${fillVoice(t('charVoice.longWords'), { share: pct(profile.longWords) })}`} />
        <Stat label={t('charVoice.distinctive')} value={profile.distinctive.map((d) => `${d.word} (${d.count})`).join(', ')} />
        <Stat label={t('charVoice.catchphrases')} value={profile.catchphrases.map((c) => `«${c.phrase}» (${c.count})`).join(', ')} />
      </dl>
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-text-dim">{t('charVoice.description')}</p>
        {draft === null ? (
          <>
            {card?.voice?.description ? <p data-testid="voice-description" className="whitespace-pre-wrap text-[11px] text-text-primary">{card.voice.description}</p> : <p className="text-[10px] text-text-dim">{t('charVoice.noDescription')}</p>}
            <div className="flex flex-wrap gap-1">
              <button type="button" data-testid="voice-describe" disabled={busy} className={voiceButton} onClick={() => {
                setBusy(true); setFailure(null);
                describeVoice(report, profile.characterId, locale === 'es').then((text) => setDraft(text), (e: unknown) => setFailure(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
              }}><Sparkles size={11} aria-hidden="true" />{busy ? t('charVoice.describing') : t('charVoice.describe')}</button>
              <button type="button" data-testid="voice-write" className={voiceButton} onClick={() => setDraft(card?.voice?.description ?? '')}>{t(card?.voice?.description ? 'charVoice.edit' : 'charVoice.write')}</button>
              {card?.voice?.description && <button type="button" className={voiceButton} onClick={() => void save(null)}>{t('charVoice.remove')}</button>}
              {undo && <button type="button" data-testid="voice-undo" className={voiceButton} onClick={() => { const r = undo; setUndo(null); revertVoiceDescription(projectId, r).catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e))); }}><Undo2 size={11} aria-hidden="true" />{t('charVoice.undo')}</button>}
            </div>
          </>
        ) : (
          <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); void save(draft); }}>
            <textarea data-testid="voice-draft" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} className={field} />
            <div className="flex gap-1">
              <button type="submit" data-testid="voice-save" className={voiceButton}>{t('charVoice.save')}</button>
              <button type="button" className={voiceButton} onClick={() => setDraft(null)}>{t('charVoice.cancel')}</button>
            </div>
          </form>
        )}
        {failure && <p role="alert" className="text-[10px] text-red-300">{failure}</p>}
      </div>
    </div>
  );
}
