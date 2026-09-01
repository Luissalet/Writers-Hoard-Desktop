// ============================================================================
// Copilot — one row of the conversation
// ============================================================================

import { useMemo } from 'react';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { markdownToTiptapHtml } from '@/services/aiBridge/markdown';
import { sanitizedHtml } from '@/utils/sanitizeRichHtml';
import type { VramContention } from '@/services/aiRuntime/sdServer';
import type { AiMessage } from '@/services/copilot/types';
import ToolCallCard from './ToolCallCard';

interface CopilotMessageProps {
  message: AiMessage;
  /** Live text while this row is still streaming. */
  liveText?: string;
  liveReasoning?: string;
  onApprove?: (callId: string, approved: boolean) => void;
  /**
   * Present on a turn that ended badly (error, timeout or cancelled): run it
   * again from the same history, without asking the reader to retype anything.
   */
  onRetry?: () => void;
  /** True while another turn is running: the control is shown, but refuses. */
  retryDisabled?: boolean;
  /** Set on an image tool call when a chat model is holding the GPU. */
  vramContention?: VramContention | null;
}

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => sanitizedHtml(markdownToTiptapHtml(text)), [text]);
  return <div className="copilot-md text-sm text-text-primary" dangerouslySetInnerHTML={html} />;
}

export default function CopilotMessage({
  message,
  liveText,
  liveReasoning,
  onApprove,
  onRetry,
  retryDisabled,
  vramContention,
}: CopilotMessageProps) {
  const { t } = useTranslation();

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-accent-gold/15 px-3 py-2 text-sm text-text-primary whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === 'tool' && message.toolCall) {
    return (
      <div className="pl-1">
        <ToolCallCard
          messageId={message.id}
          record={message.toolCall}
          onApprove={onApprove ? (approved) => onApprove(message.toolCall!.callId, approved) : undefined}
          vramContention={vramContention}
        />
      </div>
    );
  }

  const streaming = message.status === 'streaming';
  const text = streaming ? liveText ?? '' : message.content;
  const showReasoning = streaming && !text && liveReasoning;

  return (
    <div className="space-y-1.5">
      {showReasoning && (
        <p className="text-[11px] text-text-dim italic line-clamp-3 whitespace-pre-wrap">{liveReasoning.slice(-400)}</p>
      )}
      {text ? (
        <Markdown text={text} />
      ) : streaming ? (
        <div className="flex items-center gap-2 text-xs text-text-dim">
          <Loader2 size={12} className="animate-spin" />
          {t('copilot.thinking')}
        </div>
      ) : null}
      {message.status === 'error' && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-2.5 py-1.5 text-xs text-danger">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          <span className="break-words">{message.error ?? t('copilot.error.generic')}</span>
        </div>
      )}
      {message.status === 'cancelled' && (
        <p className="text-[11px] text-text-dim italic">{t('copilot.cancelled')}</p>
      )}
      {/* Offered for every way a turn can end badly — the failure, the
          15-minute timeout and the cancel alike — and by the same route: the
          stored turn is replayed, never retyped. */}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retryDisabled}
          title={t('copilot.retryHint')}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-accent-gold hover:bg-accent-gold/10 transition disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <RotateCcw size={11} />
          {t('copilot.retry')}
        </button>
      )}
      {message.notice && (
        <p className="text-[11px] text-warning flex items-center gap-1">
          <AlertTriangle size={11} />
          {t(`copilot.notice.${message.notice}`)}
        </p>
      )}
      {!streaming && message.usage?.tokensPerSecond ? (
        <p className="text-[10px] text-text-dim tabular-nums" title={t('copilot.usage.hint')}>
          {t('copilot.usage.speed').replace('{tps}', String(Math.round(message.usage.tokensPerSecond)))}
          {message.usage.completionTokens ? ` · ${t('copilot.usage.tokens').replace('{n}', String(message.usage.completionTokens))}` : ''}
          {message.usage.approximate ? ' ≈' : ''}
        </p>
      ) : null}
    </div>
  );
}
