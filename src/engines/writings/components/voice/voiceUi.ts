// Shared bits of the voice components (kept apart so the component files only export components).
export const voiceButton = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-elevated hover:text-text-primary disabled:opacity-50';

export function fillVoice(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
}
