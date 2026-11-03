import { useEffect, useState } from 'react';
import { listWikiAddresses, serveWikiEdition, withdrawWikiAddress } from '@/services/wikiProfiles/hosting';
import { WIKI_HOST_SLUG, type WikiHostAddress, type WikiHostAudience } from '@/services/wikiProfiles/hostingTypes';
import type { WikiProfile } from '@/services/wikiProfiles/types';

export default function WikiHostingPanel({ projectId, profile, locale, control, button }: {
  projectId: string;
  profile?: WikiProfile;
  locale: 'es' | 'en';
  control: string;
  button: string;
}) {
  const es = locale === 'es';
  const [addresses, setAddresses] = useState<WikiHostAddress[]>();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [slug, setSlug] = useState('');
  const [audience, setAudience] = useState<WikiHostAudience>('public');
  const [editionId, setEditionId] = useState('');
  const editions = profile?.editions ?? [];
  const selected = editions.find(edition => edition.id === editionId) ?? editions.at(-1);
  const existing = addresses?.find(address => address.slug === slug);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void listWikiAddresses({ projectId }).then(result => {
      if (active) { setAddresses(result); setError(''); }
    }, () => {
      if (active) setError('wiki_host_unavailable');
    });
    return () => { active = false; };
  }, [projectId, reload, open]);

  async function update(work: () => Promise<WikiHostAddress>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await work();
      setAddresses(current => [...(current ?? []).filter(address => address.slug !== next.slug), next]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'wiki_host_unavailable');
    } finally { setBusy(false); }
  }

  return <details className="border-t border-border pt-4" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-display text-lg">{es ? 'Enlaces de la wiki' : 'Wiki links'}</summary>
    <div className="mt-3 space-y-3">
    <p className="text-sm text-text-muted">{es
      ? 'El enlace muestra la edición elegida. Los cambios del mundo no aparecen hasta que publiques otra edición en esa dirección.'
      : 'The link shows the selected edition. World changes appear only when you publish another edition to that address.'}</p>
    {profile && selected && <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
      event.preventDefault();
      if (addresses && (!existing || existing.profileId === profile.id)) {
        void update(() => serveWikiEdition({ projectId, profileId: profile.id, slug, editionId: selected.id, audience, expectedRevision: existing?.revision ?? 0 }));
      }
    }}>
      <label className="grid gap-1 text-sm">{es ? 'Edición' : 'Edition'}
        <select className={control} value={selected.id} onChange={event => setEditionId(event.target.value)}>
          {editions.map((edition, index) => <option key={edition.id} value={edition.id}>v{index + 1} · {new Date(edition.publishedAt).toLocaleString(locale)}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">{es ? 'Ruta del enlace' : 'Link path'}
        <input className={control} value={slug} onChange={event => setSlug(event.target.value)} required pattern={WIKI_HOST_SLUG.source} placeholder={es ? 'mi-mundo' : 'my-world'} />
      </label>
      <label className="grid gap-1 text-sm">{es ? 'Quién puede verlo' : 'Who can see it'}
        <select className={control} value={audience} onChange={event => setAudience(event.target.value === 'unlisted' ? 'unlisted' : 'public')}>
          <option value="public">{es ? 'Público' : 'Public'}</option>
          <option value="unlisted">{es ? 'Sólo con enlace privado' : 'Private link only'}</option>
        </select>
      </label>
      <button className={button} disabled={busy || !addresses || !slug || Boolean(existing && existing.profileId !== profile.id)}>
        {existing?.active ? (es ? 'Actualizar enlace' : 'Update link') : (es ? 'Publicar enlace' : 'Publish link')}
      </button>
    </form>}
    {!!addresses?.length && <ul className="space-y-2">
      {addresses.map(address => <li key={address.slug} className="flex flex-wrap items-center gap-2 text-sm">
        {address.url ? <a className="break-all underline" href={address.url} target="_blank" rel="noreferrer">{address.url}</a>
          : <span>{address.slug} · {es ? 'Retirado' : 'Withdrawn'}</span>}
        {profile?.id === address.profileId && <button type="button" className={button} disabled={busy} onClick={() => {
          setSlug(address.slug); setAudience(address.audience); setEditionId(address.editionId);
        }}>{es ? 'Usar esta ruta' : 'Use this path'}</button>}
        {address.active && <button type="button" className={button} disabled={busy} onClick={() => {
          void update(() => withdrawWikiAddress({ projectId, profileId: address.profileId, slug: address.slug, expectedRevision: address.revision }));
        }}>{es ? 'Retirar enlace' : 'Withdraw link'}</button>}
      </li>)}
    </ul>}
    {error && <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-sm text-danger">{error === 'wiki_host_conflict'
        ? (es ? 'La dirección ya está en uso o ha cambiado. Actualiza la lista.' : 'The address is in use or has changed. Refresh the list.')
        : (es ? 'No se pudo gestionar el enlace de la wiki.' : 'Could not manage the wiki link.')}</p>
      <button type="button" className={button} disabled={busy} onClick={() => setReload(value => value + 1)}>{es ? 'Actualizar lista' : 'Refresh list'}</button>
    </div>}
    </div>
  </details>;
}
