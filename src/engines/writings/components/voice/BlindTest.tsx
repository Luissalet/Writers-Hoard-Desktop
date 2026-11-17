import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { blindSample, scoreBlind, MIN_PROFILE_LINES } from '@/engines/writings/voice/profile';
import type { VoiceReport } from '@/services/voice/report';
import { fillVoice, voiceButton } from './voiceUi';

const SIZES = [6, 10, 20];

/** Lines without their speaker: the author guesses, the result says which voices get mixed up. */
export default function BlindTest({ report }: { report: VoiceReport }) {
  const { t } = useTranslation();
  const [size, setSize] = useState(10);
  const [seed, setSeed] = useState<number | null>(null);
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const items = useMemo(() => (seed === null ? [] : blindSample(report.lines, report.profiles, size, seed)), [report, size, seed]);
  const voices = report.profiles.filter((p) => p.lines >= MIN_PROFILE_LINES).map((p) => p.characterId).sort((a, b) => (report.titles[a] ?? a).localeCompare(report.titles[b] ?? b));
  const name = (id: string) => report.titles[id] ?? id;
  if (voices.length < 2) return <p className="text-[10px] text-text-dim">{fillVoice(t('charVoice.blind.needVoices'), { lines: MIN_PROFILE_LINES })}</p>;
  if (seed === null || !items.length) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <label className="text-[10px] text-text-dim">{t('charVoice.blind.size')}
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="ml-1 rounded border border-border bg-elevated px-1 py-0.5 text-[10px]">
            {SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" data-testid="voice-blind-start" className="rounded-md bg-accent-gold/20 px-2 py-1 text-[11px] font-semibold text-accent-gold hover:bg-accent-gold/30" onClick={() => { setGuesses({}); setSeed(Date.now() % 2147483647); }}>{t('charVoice.blind.start')}</button>
      </div>
    );
  }
  const current = items.find((item) => !guesses[item.lineId]);
  if (current) {
    const done = items.length - items.filter((item) => !guesses[item.lineId]).length;
    return (
      <div className="space-y-2" data-testid="voice-blind-question">
        <p className="text-[10px] text-text-dim">{fillVoice(t('charVoice.blind.progress'), { n: done + 1, total: items.length })}</p>
        <p className="rounded-md bg-deep p-2 text-[12px] italic text-text-primary">«{current.text}»</p>
        <div className="flex flex-wrap gap-1">
          {voices.map((id) => <button key={id} type="button" data-testid="voice-blind-guess" className="rounded-md border border-border px-2 py-0.5 text-[11px] text-text-primary hover:border-accent-gold" onClick={() => setGuesses((g) => ({ ...g, [current.lineId]: id }))}>{name(id)}</button>)}
        </div>
        <button type="button" className={voiceButton} onClick={() => setSeed(null)}>{t('charVoice.blind.stop')}</button>
      </div>
    );
  }
  const result = scoreBlind(items, guesses);
  return (
    <div className="space-y-2" data-testid="voice-blind-result">
      <p className="text-[12px] font-semibold text-text-primary">{fillVoice(t('charVoice.blind.score'), { correct: result.correct, total: result.total })}</p>
      {result.confusions.length ? (
        <ul className="space-y-0.5 text-[11px] text-text-muted">
          {result.confusions.map((c) => <li key={`${c.actualId}>${c.guessedId}`}>{fillVoice(t('charVoice.blind.confusion'), { actual: name(c.actualId), guessed: name(c.guessedId), count: c.count })}</li>)}
        </ul>
      ) : <p className="text-[11px] text-text-muted">{t('charVoice.blind.noConfusion')}</p>}
      <ul className="space-y-0.5 text-[10px] text-text-dim">
        {items.map((item) => <li key={item.lineId} className={guesses[item.lineId] === item.answerId ? 'text-emerald-300' : 'text-red-300'}>«{item.text.slice(0, 80)}» — {name(item.answerId)}</li>)}
      </ul>
      <button type="button" className={voiceButton} onClick={() => { setGuesses({}); setSeed(Date.now() % 2147483647); }}>{t('charVoice.blind.again')}</button>
    </div>
  );
}
