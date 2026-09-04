// ============================================================================
// What the prompt actually says — weights, length, wildcards, and the traps
// ============================================================================
//
// Three facts a writer cannot get from a text box, all of them free:
//
//   * which words are emphasised, and by how much;
//   * roughly how long the prompt is, and whether it has crossed into a second
//     CLIP chunk, where everything after the boundary is encoded separately and
//     stops interacting with what came before;
//   * that `[cat:dog:0.4]` and BREAK are not implemented by this runtime and
//     will be encoded as literal words.
//
// The last one matters most. A writer who has read an A1111 tutorial WILL type
// prompt scheduling, and a silently different image is worse than an absent
// feature — so the trap is named, at the moment it is typed.

import { useTranslation } from '@/i18n/useTranslation';
import {
  estimateTokens,
  hasWildcards,
  unsupportedSyntax,
  weightedSpans,
  type WildcardPick,
} from '../studio';

export interface PromptCraftBarProps {
  /** The resolved prompt: what will actually be encoded, not what was typed. */
  prompt: string;
  /** The picks a preview resolution made, so the writer sees what they will get. */
  wildcards?: readonly WildcardPick[];
  unresolvedWildcards?: readonly string[];
  /**
   * Whether the seed these picks came from is the one that will run. In explore
   * mode it is not — the dice are rolled at generate time — so the preview is
   * one possible roll and must not claim to be the outcome.
   */
  seedKnown?: boolean;
}

export default function PromptCraftBar({ prompt, wildcards, unresolvedWildcards, seedKnown }: PromptCraftBarProps) {
  const { t } = useTranslation();
  const tokens = estimateTokens(prompt);
  const spans = weightedSpans(prompt);
  const traps = unsupportedSyntax(prompt);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 flex-wrap text-[10px] text-text-dim">
        <span className="font-mono">
          {t('imageStudio.prompt.tokens').replace('{count}', String(tokens.tokens))}
        </span>
        {tokens.chunks > 1 && (
          <span className="text-accent-amber">
            {t('imageStudio.prompt.chunks').replace('{count}', String(tokens.chunks))}
          </span>
        )}
        <span className="ml-auto">{t('imageStudio.prompt.weightKeys')}</span>
      </div>

      {spans.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {spans.map((span) => (
            <span
              key={`${span.start}-${span.text}`}
              title={t('imageStudio.prompt.weighted')}
              className={`px-1 py-0.5 rounded text-[9px] font-mono border ${
                span.weight >= 1
                  ? 'border-accent-gold/40 text-accent-gold'
                  : 'border-border text-text-dim'
              }`}
            >
              {span.text} ×{span.weight.toFixed(2)}
            </span>
          ))}
        </div>
      )}

      {hasWildcards(prompt) && wildcards && wildcards.length > 0 && (
        <p className="text-[10px] text-text-dim">
          {t(seedKnown ? 'imageStudio.prompt.wildcardPreview' : 'imageStudio.prompt.wildcardExample')}
          {' '}
          <span className="font-mono">
            {wildcards.map((pick) => `${pick.token} → ${pick.choice}`).join(' · ')}
          </span>
        </p>
      )}

      {unresolvedWildcards && unresolvedWildcards.length > 0 && (
        <p className="text-[10px] text-accent-amber">
          {t('imageStudio.prompt.wildcardUnknown').replace('{names}', unresolvedWildcards.join(', '))}
        </p>
      )}

      {traps.map((trap) => (
        <p key={trap} className="text-[10px] text-accent-amber">
          {t(`imageStudio.prompt.unsupported.${trap}`)}
        </p>
      ))}
    </div>
  );
}
