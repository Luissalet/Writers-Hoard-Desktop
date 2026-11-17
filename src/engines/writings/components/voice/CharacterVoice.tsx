import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, MessageSquareQuote } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useVoiceReport } from '@/services/voice/useVoiceReport';
import VoiceOutliers from './VoiceOutliers';
import VoiceProfileCard from './VoiceProfileCard';

/** The voice section of a character's Codex card: same report as the panel beside the manuscript. */
export default function CharacterVoice({ projectId, characterId }: { projectId: string; characterId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { report } = useVoiceReport(projectId, !open);
  const profile = report?.profiles.find((p) => p.characterId === characterId);
  const outliers = (report?.outliers ?? []).filter((o) => o.speakerId === characterId);
  return (
    <section className="space-y-2 rounded-lg border border-border bg-surface p-3" data-testid="codex-voice">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        <MessageSquareQuote size={14} className="text-accent-gold" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-text-primary">{t('charVoice.title')}</h3>
      </button>
      {open && (!report ? <p className="text-xs text-text-dim">{t('charVoice.loading')}</p>
        : !profile ? <p className="text-xs text-text-dim">{t('charVoice.noLinesFor')}</p>
          : (
            <div className="space-y-3">
              <VoiceProfileCard report={report} profile={profile} projectId={projectId} />
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-text-dim">{t('charVoice.tab.outliers')}</p>
                <VoiceOutliers report={report} outliers={outliers}
                  onOpen={(writingId, quote) => navigate(`/project/${encodeURIComponent(projectId)}/writings?writing=${encodeURIComponent(writingId)}&quote=${encodeURIComponent(quote)}`)} />
              </div>
            </div>
          ))}
    </section>
  );
}
