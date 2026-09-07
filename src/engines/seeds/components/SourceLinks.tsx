import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { navigateTo } from '@/engines/_shared/anchoring';
import { useTranslation } from '@/i18n/useTranslation';
import type { Seed, Payoff } from '../types';
import { getSeedsCopy } from '../copy';

import { seedSourceLinks, type SeedSourceCatalog } from '../sourceLinks';
export type { SeedSourceCatalog } from '../sourceLinks';

export default function SourceLinks({ row, catalog, kind, beforeNavigate }: { row: Seed | Payoff; catalog: SeedSourceCatalog; kind: 'planting' | 'payoff'; beforeNavigate: () => Promise<boolean> }) {
  const { locale } = useTranslation();
  const copy = getSeedsCopy(locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const links = seedSourceLinks(row, catalog);
  if (!links.length) return null;
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">{links.map((link) => <button key={link.path} type="button" disabled={busy} onClick={async () => {
      if (busy) return;
      setBusy(true); setError(false);
      try { if (await beforeNavigate()) navigateTo(link.path); else setError(true); }
      catch { setError(true); }
      finally { setBusy(false); }
    }} className="flex max-w-full items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-accent-gold hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50"><ExternalLink size={12} className="shrink-0"/><span className="truncate">{copy[kind]}: {link.title}</span></button>)}</div>
    {error && <p role="alert" className="text-xs text-danger">{copy.navigationFailed}</p>}
  </div>;
}
