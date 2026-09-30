import type { CodexEntry } from '@/types';
import type { ClaimStatus, InquiryRef } from '../types';


export const fieldClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-gold';
export const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary transition hover:border-accent-gold hover:text-accent-gold focus-visible:outline focus-visible:outline-accent-gold disabled:opacity-50';
export const primaryClass = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent-gold px-3 py-1.5 text-sm font-medium text-background transition hover:brightness-110 focus-visible:outline focus-visible:outline-accent-gold disabled:opacity-50';
export const cardClass = 'rounded-xl border border-border bg-surface';

/** Chip colours and the hex used for graph edges, per derived status. */
export const STATUS_STYLE: Record<ClaimStatus, { chip: string; color: string }> = {
  confirmed: { chip: 'border-emerald-500 text-emerald-400', color: '#10b981' },
  corroborated: { chip: 'border-teal-500 text-teal-400', color: '#14b8a6' },
  claimed: { chip: 'border-sky-500 text-sky-400', color: '#0ea5e9' },
  disputed: { chip: 'border-orange-500 text-orange-400', color: '#f97316' },
  unsupported: { chip: 'border-border text-text-dim', color: '#9ca3af' },
  retracted: { chip: 'border-red-500 text-red-400 line-through', color: '#ef4444' },
};

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_all, key: string) => String(values[key] ?? ''));
}


export function refLabel(ref: InquiryRef | undefined, entries: ReadonlyMap<string, CodexEntry>, missing: string): string {
  if (!ref) return '';
  if (ref.kind === 'text') return ref.text;
  return entries.get(ref.id)?.title ?? missing;
}

export function validityLabel(from?: string, to?: string): string {
  if (!from && !to) return '';
  return `${from ?? '…'} → ${to ?? '…'}`;
}
