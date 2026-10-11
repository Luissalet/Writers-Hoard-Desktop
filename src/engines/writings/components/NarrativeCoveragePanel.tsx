import { useCallback, useEffect, useMemo, useState } from 'react';
import { Grid3x3, Loader2, RefreshCw, X } from 'lucide-react';
import {
  loadCoverageMatrix,
  loadTimelineEvidence,
  setCoverageCell,
  setTimelineEvidence,
  type CoverageMatrix,
  type CoverageRole,
  type EvidenceStatus,
  type TimelineEvidenceReport,
} from '@/services/narrativeXray/coverageEvidence';

const ROLES: CoverageRole[] = ['absent', 'mention', 'presence', 'pov'];
const EVIDENCE: EvidenceStatus[] = ['narrated', 'not_narrated', 'contradiction', 'unverified'];

const roleTone: Record<CoverageRole, string> = {
  absent: 'bg-elevated text-text-muted',
  mention: 'bg-accent-gold/15 text-accent-gold',
  presence: 'bg-emerald-500/15 text-emerald-400',
  pov: 'bg-sky-500/15 text-sky-400',
};

interface Props {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

export default function NarrativeCoveragePanel({ projectId, open, onClose }: Props) {
  const [matrix, setMatrix] = useState<CoverageMatrix | null>(null);
  const [evidence, setEvidence] = useState<TimelineEvidenceReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'matrix' | 'evidence'>('matrix');

  const reload = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [nextMatrix, nextEvidence] = await Promise.all([
        loadCoverageMatrix(projectId),
        loadTimelineEvidence(projectId),
      ]);
      setMatrix(nextMatrix);
      setEvidence(nextEvidence);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const sparseCells = useMemo(
    () => (matrix?.cells ?? []).filter((cell) => cell.role !== 'absent' || cell.manual),
    [matrix],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Grid3x3 size={18} className="text-accent-gold" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-text-primary">Narrative coverage</h2>
            <p className="text-xs text-text-muted">
              Mention ≠ presence/POV. Planning links are flags only. Stale hashes force unverified.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-lg border border-border p-2 text-text-muted hover:text-accent-gold"
            title="Reload"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-border p-2 text-text-muted hover:text-text-primary">
            <X size={16} />
          </button>
        </header>

        <div className="flex gap-2 border-b border-border px-4 py-2">
          <button
            type="button"
            onClick={() => setTab('matrix')}
            className={`rounded-lg px-3 py-1.5 text-sm ${tab === 'matrix' ? 'bg-accent-gold/20 text-accent-gold' : 'text-text-muted'}`}
          >
            Coverage matrix
          </button>
          <button
            type="button"
            onClick={() => setTab('evidence')}
            className={`rounded-lg px-3 py-1.5 text-sm ${tab === 'evidence' ? 'bg-accent-gold/20 text-accent-gold' : 'text-text-muted'}`}
          >
            Timeline evidence
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

          {tab === 'matrix' && matrix && (
            <div className="space-y-4">
              {matrix.emptyLinkedBeats.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                  <p className="font-medium">Empty linked beats</p>
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {matrix.emptyLinkedBeats.map((beat) => (
                      <li key={beat.beatId}>
                        {beat.title} → {beat.writingTitle}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-surface p-2 text-left text-text-muted">Character</th>
                      {matrix.writings.map((writing) => (
                        <th key={writing.id} className="max-w-[8rem] truncate p-2 text-left text-text-muted" title={writing.title}>
                          {writing.chapter != null ? `Ch.${writing.chapter}` : writing.title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.characters.map((character) => (
                      <tr key={character.id} className="border-t border-border/60">
                        <td className="sticky left-0 bg-surface p-2 font-medium text-text-primary">{character.name}</td>
                        {matrix.writings.map((writing) => {
                          const cell = matrix.cells.find(
                            (row) => row.characterId === character.id && row.writingId === writing.id,
                          );
                          if (!cell) return <td key={writing.id} />;
                          const planBits = [
                            cell.plannedPresence ? 'plannedPresence' : null,
                            cell.plannedPov ? 'plannedPov' : null,
                            cell.overrideStale ? 'overrideStale' : null,
                          ].filter(Boolean);
                          const title = [
                            cell.manual ? `manual (inferred ${cell.inferred})` : `inferred ${cell.inferred}`,
                            planBits.length ? planBits.join('+') : null,
                          ]
                            .filter(Boolean)
                            .join(' · ');
                          return (
                            <td key={writing.id} className="p-1">
                              <select
                                className={`w-full rounded border px-1 py-1 ${
                                  cell.overrideStale ? 'border-amber-500/60 ' : 'border-border '
                                }${roleTone[cell.role]}`}
                                value={cell.role}
                                title={title}
                                onChange={(event) => {
                                  const role = event.target.value as CoverageRole;
                                  void setCoverageCell({
                                    projectId,
                                    characterId: character.id,
                                    writingId: writing.id,
                                    role,
                                  }).then(() => reload());
                                }}
                              >
                                {ROLES.map((role) => (
                                  <option key={role} value={role}>
                                    {role}
                                    {planBits.length && role === cell.role ? ' *' : ''}
                                  </option>
                                ))}
                              </select>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-text-muted">
                Non-absent cells: {sparseCells.length}. Mention never upgrades itself. Entity links show as
                plannedPresence/plannedPov only — set presence manually; POV from pov:Name tags or manual.
              </p>
            </div>
          )}

          {tab === 'evidence' && evidence && (
            <div className="space-y-2">
              {evidence.rows.length === 0 && (
                <p className="text-sm text-text-muted">No timeline events in this project yet.</p>
              )}
              {evidence.rows.map((row) => (
                <div
                  key={row.eventId}
                  className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
                    row.stale
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-border'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary">{row.title}</p>
                    <p className="text-xs text-text-muted">
                      effective {row.status} · inferred {row.inferred}
                      {row.stale ? ' · STALE → unverified' : ''}
                      {row.manual && !row.stale ? ` · manual ${row.manual}` : ''}
                      {row.witness
                        ? ` · witness Ch.${row.witness.chapter ?? '?'} «${row.witness.excerpt}»`
                        : ''}
                      {row.linkedEntryId ? ` · linked ${row.linkedEntryId}` : ' · no linked character'}
                    </p>
                  </div>
                  <select
                    className="rounded-lg border border-border bg-background px-2 py-1 text-sm"
                    value={row.status}
                    title={row.stale ? 'Stale hash forces unverified until you set a fresh judgment' : undefined}
                    onChange={(event) => {
                      const status = event.target.value as EvidenceStatus;
                      void setTimelineEvidence({
                        projectId,
                        eventId: row.eventId,
                        status,
                        writingId: row.writingId,
                      }).then(() => reload());
                    }}
                  >
                    {EVIDENCE.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
