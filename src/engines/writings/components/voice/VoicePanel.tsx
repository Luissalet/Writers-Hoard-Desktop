import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookUser, ChevronDown, ChevronRight, MessageSquareQuote } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DialogueAnchor } from '@/engines/writings/voice/dialogue';
import { useVoiceReport } from '@/services/voice/useVoiceReport';
import BlindTest from './BlindTest';
import VoiceOutliers from './VoiceOutliers';
import VoiceProfileCard from './VoiceProfileCard';
import { fillVoice, voiceButton } from './voiceUi';

type Tab = 'profiles' | 'outliers' | 'blind';

/**
 * Voice by character beside the manuscript: each character's profile from
 * their dialogue, the lines that leave it, and the blind test. Same report as
 * the Codex card and the AI bridge.
 */
export default function VoicePanel({ projectId, writingId, onOpenLine }: { projectId: string; writingId: string; onOpenLine: (writingId: string, anchor: DialogueAnchor) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { report, loading, error } = useVoiceReport(projectId, !open);
  const [tab, setTab] = useState<Tab>('profiles');
  const [pick, setPick] = useState('');
  const [all, setAll] = useState(false);
  const profiles = report?.profiles ?? [];
  const profile = profiles.find((p) => p.characterId === pick) ?? profiles[0];
  const outliers = (report?.outliers ?? []).filter((o) => all || report?.lines.find((l) => l.id === o.lineId)?.writingId === writingId);
  return (
    <section aria-label={t('charVoice.title')} data-testid="voice-panel" className="overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/10">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left">
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        <MessageSquareQuote size={15} className="text-accent-gold" aria-hidden="true" />
        <h2 className="flex-1 text-xs font-bold text-text-primary">{t('charVoice.title')}</h2>
        {report && report.outliers.length > 0 && <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-semibold text-amber-300">{report.outliers.length}</span>}
      </button>
      {open && (
        <div className="space-y-3 p-3">
          <div role="tablist" className="grid grid-cols-3 gap-1 rounded-lg bg-deep p-1">
            {(['profiles', 'outliers', 'blind'] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} data-testid={`voice-tab-${id}`} onClick={() => setTab(id)}
                className={`rounded-md px-1.5 py-1.5 text-[10px] ${tab === id ? 'bg-elevated font-semibold text-accent-gold shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>{t(`charVoice.tab.${id}`)}</button>
            ))}
          </div>
          {error && <p role="alert" className="text-[10px] text-red-300">{error}</p>}
          {!report ? <p className="text-[10px] text-text-dim">{t('charVoice.loading')}</p> : (
            <>
              <p className="text-[10px] text-text-dim" data-testid="voice-summary">{fillVoice(t('charVoice.summary'), { lines: report.lines.length, unattributed: report.unattributed })}{loading ? ` · ${t('charVoice.loading')}` : ''}</p>
              {tab === 'profiles' && (!profile ? <p className="text-[10px] text-text-dim">{t('charVoice.noProfiles')}</p> : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <select data-testid="voice-character" value={profile.characterId} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-text-primary">
                      {profiles.map((p) => <option key={p.characterId} value={p.characterId}>{report.titles[p.characterId] ?? p.characterId} ({p.lines})</option>)}
                    </select>
                    <button type="button" className={voiceButton} onClick={() => {
                      const search = new URLSearchParams({ entry: profile.characterId });
                      if (report.eraId) search.set('era', report.eraId);
                      navigate(`/project/${encodeURIComponent(projectId)}/codex?${search}`);
                    }}><BookUser size={11} aria-hidden="true" />{t('charVoice.openCard')}</button>
                  </div>
                  <VoiceProfileCard key={profile.characterId} report={report} profile={profile} projectId={projectId} />
                </div>
              ))}
              {tab === 'outliers' && (
                <div className="space-y-2" data-testid="voice-outliers">
                  <div className="flex gap-1 text-[10px]">
                    {[false, true].map((value) => <button key={String(value)} type="button" onClick={() => setAll(value)} className={`rounded px-2 py-0.5 ${all === value ? 'bg-elevated text-accent-gold' : 'text-text-muted'}`}>{t(value ? 'charVoice.allChapters' : 'charVoice.thisChapter')}</button>)}
                  </div>
                  <VoiceOutliers report={report} outliers={outliers} onOpen={onOpenLine} />
                </div>
              )}
              {tab === 'blind' && <BlindTest report={report} />}
            </>
          )}
        </div>
      )}
    </section>
  );
}
