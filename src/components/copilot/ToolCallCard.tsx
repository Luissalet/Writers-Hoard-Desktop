// ============================================================================
// Copilot — one tool call, as a card
// ============================================================================
//
// Proposed (waiting for a yes/no), running, done, failed or rejected. A done
// write carries its audit line, so Undo here takes the same path as the
// settings panel and the CLI: `aiBridge.undo(index)`.

import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  Loader2,
  Pencil,
  ShieldAlert,
  Sparkles,
  Trash2,
  Undo2,
  X,
  XCircle,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import VramWarning from '@/components/ai-settings/VramWarning';
import { SCOPE_KEY } from '@/services/aiBridge/schema';
import type { VramContention } from '@/services/aiRuntime/sdServer';
import type { AiToolCallRecord } from '@/services/copilot/types';
import { updateMessage } from '@/services/copilot/threads';

interface ToolCallCardProps {
  messageId: string;
  record: AiToolCallRecord;
  onApprove?: (approved: boolean) => void;
  /**
   * Set by the dock when this call is about to make a picture and a chat model
   * is holding the graphics card — the same physics, and the same way out, that
   * the Image Studio shows before its own Generate button.
   */
  vramContention?: VramContention | null;
}

function riskIcon(risk: string) {
  if (risk === 'destructive') return Trash2;
  if (risk === 'external') return Sparkles;
  if (risk === 'write') return Pencil;
  return Eye;
}

function shortArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args ?? {}).filter(
    ([key]) => key !== 'projectId' && key !== SCOPE_KEY,
  );
  if (!entries.length) return '';
  return entries
    .map(([key, value]) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      return `${key}: ${text.length > 60 ? `${text.slice(0, 57)}…` : text}`;
    })
    .join(' · ');
}

export default function ToolCallCard({ messageId, record, onApprove, vramContention }: ToolCallCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  // What the reversal could NOT put back. The record type has nowhere to keep
  // it, so it lives here: the card is open when the button is pressed, which
  // is the moment the user has to read it.
  const [undoCaveat, setUndoCaveat] = useState<string | null>(null);
  const Icon = riskIcon(record.risk);
  const label = record.tool.replace(/^wh_/, '').replace(/_/g, ' ');
  const canUndo =
    record.state === 'done' && record.ok && typeof record.auditIndex === 'number' && !record.undone && record.risk !== 'read';

  const stateText =
    record.state === 'proposed'
      ? t('copilot.tool.proposed')
      : record.state === 'running'
        ? t('copilot.tool.running')
        : record.state === 'rejected'
          ? t('copilot.tool.rejected')
          : record.state === 'failed'
            ? t('copilot.tool.failed')
            : record.undone
              ? t('copilot.tool.undone')
              : record.summary ?? t('copilot.tool.done');

  const undo = async () => {
    const bridge = window.electronAPI?.aiBridge;
    if (!bridge || typeof record.auditIndex !== 'number') return;
    setUndoing(true);
    setUndoError(null);
    setUndoCaveat(null);
    try {
      const result = await bridge.undo(record.auditIndex);
      if (result.ok) {
        setUndoCaveat((result.result as { caveat?: string } | undefined)?.caveat ?? null);
        await updateMessage(messageId, { toolCall: { ...record, undone: true } });
      } else {
        setUndoError(result.error ?? 'error');
      }
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div
      className={`rounded-lg border text-xs ${
        record.state === 'proposed'
          ? 'border-accent-gold/50 bg-accent-gold/5'
          : record.state === 'failed'
            ? 'border-danger/40 bg-danger/5'
            : 'border-border bg-surface'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {record.state === 'running' ? (
          <Loader2 size={12} className="animate-spin text-accent-gold flex-shrink-0" />
        ) : record.state === 'proposed' ? (
          <ShieldAlert size={12} className="text-accent-gold flex-shrink-0" />
        ) : record.state === 'failed' || record.state === 'rejected' ? (
          <XCircle size={12} className="text-danger flex-shrink-0" />
        ) : (
          <Icon size={12} className="text-text-muted flex-shrink-0" />
        )}
        <span className="font-mono text-text-primary truncate">{label}</span>
        <span className={`truncate ml-1 ${record.undone ? 'line-through text-text-dim' : 'text-text-dim'}`}>{stateText}</span>
        <span className="ml-auto text-text-dim flex-shrink-0">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      {vramContention && (
        <div className="px-2.5 pb-2">
          <VramWarning contention={vramContention} />
        </div>
      )}

      {record.state === 'proposed' && onApprove && (
        <div className="px-2.5 pb-2 space-y-1.5">
          <p className="text-[11px] text-text-muted">{t('copilot.tool.approvePrompt')}</p>
          {shortArgs(record.args) && (
            <p className="text-[11px] text-text-dim font-mono break-words">{shortArgs(record.args)}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onApprove(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent-gold text-deep font-semibold hover:bg-accent-amber transition"
            >
              <Check size={12} />
              {t('copilot.tool.approve')}
            </button>
            <button
              type="button"
              onClick={() => onApprove(false)}
              className="flex items-center gap-1 px-2.5 py-1 rounded border border-border text-text-muted hover:text-text-primary transition"
            >
              <X size={12} />
              {t('copilot.tool.reject')}
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="px-2.5 pb-2 space-y-1.5 border-t border-border/60 pt-1.5">
          {shortArgs(record.args) && record.state !== 'proposed' && (
            <p className="text-[11px] text-text-dim font-mono break-words">{shortArgs(record.args)}</p>
          )}
          {record.error && <p className="text-[11px] text-danger break-words">{record.error}</p>}
          {record.resultText && record.state === 'done' && (
            <pre className="max-h-40 overflow-auto rounded bg-deep px-2 py-1.5 text-[10px] text-text-muted whitespace-pre-wrap break-words">
              {record.resultText.slice(0, 2000)}
            </pre>
          )}
          {canUndo && (
            <button
              type="button"
              onClick={() => void undo()}
              disabled={undoing}
              className="flex items-center gap-1 text-[11px] text-text-muted hover:text-accent-gold transition disabled:opacity-50"
            >
              {undoing ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
              {t('copilot.tool.undo')}
            </button>
          )}
          {undoError && <p className="text-[11px] text-danger">{undoError}</p>}
          {/* A partial reversal that said nothing was the worst of both: the
              line reads "undone" and part of the change is still there. */}
          {undoCaveat && <p className="text-[11px] text-accent-gold break-words">{undoCaveat}</p>}
        </div>
      )}
    </div>
  );
}
