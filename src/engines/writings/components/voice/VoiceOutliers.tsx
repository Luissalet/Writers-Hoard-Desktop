import { useTranslation } from '@/i18n/useTranslation';
import { lineSource, type VoiceReport } from '@/services/voice/report';
import type { VoiceOutlier } from '@/engines/writings/voice/profile';
import { fillVoice, voiceButton } from './voiceUi';

/** Lines that leave their speaker's profile, each with a jump to the text. */
export default function VoiceOutliers({ report, outliers, onOpen }: { report: VoiceReport; outliers: readonly VoiceOutlier[]; onOpen: (writingId: string, quote: string) => void }) {
  const { t } = useTranslation();
  if (!outliers.length) return <p className="text-[10px] text-text-dim">{t('charVoice.noOutliers')}</p>;
  return (
    <ul className="space-y-1">
      {outliers.map((o) => {
        const line = report.lines.find((l) => l.id === o.lineId);
        if (!line) return null;
        const who = report.titles[o.speakerId] ?? o.speakerId;
        const why = o.reason === 'closer-to' ? fillVoice(t('charVoice.reason.closer-to'), { other: report.titles[o.otherId!] ?? o.otherId! })
          : o.reason === 'address' ? fillVoice(t('charVoice.reason.address'), { form: t(`charVoice.address.${o.detail}`) })
            : t(Number(o.detail) > 0 ? 'charVoice.reason.longer' : 'charVoice.reason.shorter');
        return (
          <li key={o.lineId} data-testid="voice-outlier" data-reason={o.reason} className="space-y-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px]">
            <p className="text-text-primary"><span className="font-semibold">{who}</span> · {why}</p>
            <p className="line-clamp-2 italic text-text-muted">«{line.text}»</p>
            <div className="flex items-center justify-between gap-2 text-[10px] text-text-dim">
              <span className="truncate">{lineSource(report, line)}</span>
              {line.writingId && <button type="button" data-testid="voice-outlier-open" className={voiceButton} onClick={() => onOpen(line.writingId!, line.quote)}>{t('charVoice.openLine')}</button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
