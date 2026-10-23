import type { WorldWikiOptions } from '@/types/worldWiki';
import { WIKI_FOOTER_LIMITS, isSafeWikiLinkUrl, type WikiFooterLink } from '@/services/wikiProfiles/appearance';

const control = 'min-h-10 min-w-0 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
type Change = (patch: Partial<WorldWikiOptions> | ((current: WorldWikiOptions) => Partial<WorldWikiOptions>)) => void;

/** A few footer links (web or mail addresses only) and a one-line signature for the exported wiki. */
export default function WikiFooterEditor({ options, change, locale }: { options: WorldWikiOptions; change: Change; locale: 'es' | 'en' }) {
  const es = locale === 'es', links = options.branding?.links ?? [];
  const setLinks = (next: WikiFooterLink[]) => change(current => ({ branding: { ...current.branding, links: next.length ? next : undefined } }));
  const edit = (index: number, patch: Partial<WikiFooterLink>) => setLinks(links.map((link, at) => at === index ? { ...link, ...patch } : link));
  return <div className="space-y-3 sm:col-span-2" data-testid="wiki-footer-editor">
    <div className="grid gap-1 text-sm"><span>{es ? 'Enlaces del pie' : 'Footer links'}</span>
      {links.map((link, index) => {
        const bad = link.url !== '' && !isSafeWikiLinkUrl(link.url);
        return <div key={index} data-testid="wiki-footer-link-row" className="flex flex-wrap items-start gap-2">
          <input type="text" data-testid="wiki-footer-link-label" aria-label={es ? `Texto del enlace ${index + 1}` : `Link ${index + 1} text`} className={`${control} w-44`} maxLength={WIKI_FOOTER_LIMITS.label} value={link.label} onChange={event => edit(index, { label: event.target.value })} />
          <span className="grid min-w-0 flex-1 gap-1"><input type="text" data-testid="wiki-footer-link-url" aria-label={es ? `Dirección del enlace ${index + 1}` : `Link ${index + 1} address`} aria-invalid={bad} placeholder="https://… / mailto:…" className={control} maxLength={WIKI_FOOTER_LIMITS.url} value={link.url} onChange={event => edit(index, { url: event.target.value.trim() })} />
            {bad && <span role="alert" data-testid="wiki-footer-link-error" className="text-xs text-danger">{es ? 'Solo se admiten direcciones http, https o mailto.' : 'Only http, https or mailto addresses are accepted.'}</span>}</span>
          <button type="button" data-testid="wiki-footer-link-remove" className={control} onClick={() => setLinks(links.filter((_, at) => at !== index))}>{es ? 'Quitar' : 'Remove'}</button>
        </div>;
      })}
      <div><button type="button" data-testid="wiki-footer-link-add" className={control} disabled={links.length >= WIKI_FOOTER_LIMITS.links} onClick={() => setLinks([...links, { label: '', url: '' }])}>{es ? 'Añadir enlace' : 'Add link'}</button></div>
    </div>
    <label className="grid gap-1 text-sm">{es ? 'Firma (una línea)' : 'Signature (one line)'}<input type="text" data-testid="wiki-footer-signature" className={control} maxLength={WIKI_FOOTER_LIMITS.signature} value={options.branding?.signature ?? ''} onChange={event => change(current => ({ branding: { ...current.branding, signature: event.target.value || undefined } }))} /></label>
  </div>;
}
