export const input = 'w-full min-w-0 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold';
export const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50 disabled:cursor-not-allowed';
export const gold = `${button} bg-accent-gold text-deep hover:bg-accent-gold/90`;
export const titleCase = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
export const signed = (value: number) => `${value >= 0 ? '+' : ''}${value}`;
