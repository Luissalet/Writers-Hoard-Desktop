import { useEffect, useRef, useState } from 'react';
import { listWikiAddresses, serveWikiEdition, withdrawWikiAddress } from '@/services/wikiProfiles/hosting';
import { WIKI_HOST_SLUG, type WikiHostAddress, type WikiHostAudience } from '@/services/wikiProfiles/hostingTypes';
import type { WikiProfile } from '@/services/wikiProfiles/types';

function coverDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error('wiki_host_cover_invalid'));
    reader.readAsDataURL(file);
  });
}

export default function WikiHostingPanel({ projectId, profile, projectTitles, locale, control, button }: {
  projectId?: string;
  profile?: WikiProfile;
  projectTitles?: Readonly<Record<string, string>>;
  locale: 'es' | 'en';
  control: string;
  button: string;
}) {
  const es = locale === 'es';
  const library = projectId === undefined;
  const [addresses, setAddresses] = useState<WikiHostAddress[]>();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [slug, setSlug] = useState('');
  const [audience, setAudience] = useState<WikiHostAudience>('public');
  const [editionId, setEditionId] = useState('');
  const coverInput = useRef<HTMLInputElement>(null);
  const [removeCover, setRemoveCover] = useState(false);
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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'wiki_host_unavailable');
    } finally { setBusy(false); }
  }

  return <details className="border-t border-border pt-4" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-display text-lg">{library
      ? (es ? 'Enlaces de wiki publicados' : 'Published wiki links')
      : (es ? 'Enlaces de la wiki' : 'Wiki links')}</summary>
    <div className="mt-3 space-y-3">
    <p className="text-sm text-text-muted">{library
      ? (es ? 'Puedes retirar enlaces aunque su proyecto ya no esté en tu biblioteca.' : 'You can withdraw links even when their project is no longer in your library.')
      : es
      ? 'El enlace muestra la edición elegida. Los cambios del mundo no aparecen hasta que publiques otra edición en esa dirección.'
      : 'The link shows the selected edition. World changes appear only when you publish another edition to that address.'}</p>
    {projectId && profile && selected && <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
      event.preventDefault();
      if (addresses && (!existing || existing.profileId === profile.id)) {
        const file = coverInput.current?.files?.[0];
        void update(async () => serveWikiEdition({
          projectId, profileId: profile.id, slug, editionId: selected.id, audience,
          expectedRevision: existing?.revision ?? 0,
          coverImage: file ? await coverDataUrl(file) : removeCover ? null : undefined,
        })).then(ok => {
          if (ok) {
            if (coverInput.current) coverInput.current.value = '';
            setRemoveCover(false);
          }
        });
      }
    }}>
      <label className="grid gap-1 text-sm">{es ? 'Edición' : 'Edition'}
        <select className={control} value={selected.id} onChange={event => setEditionId(event.target.value)}>
          {editions.map((edition, index) => <option key={edition.id} value={edition.id}>v{index + 1} · {new Date(edition.publishedAt).toLocaleString(locale)}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">{es ? 'Ruta del enlace' : 'Link path'}
        <input className={control} value={slug} disabled={busy} onChange={event => { setSlug(event.target.value); setRemoveCover(false); }} required pattern={WIKI_HOST_SLUG.source} placeholder={es ? 'mi-mundo' : 'my-world'} />
      </label>
      <label className="grid gap-1 text-sm">{es ? 'Quién puede verlo' : 'Who can see it'}
        <select className={control} value={audience} onChange={event => setAudience(event.target.value === 'unlisted' ? 'unlisted' : 'public')}>
          <option value="public">{es ? 'Público' : 'Public'}</option>
          <option value="unlisted">{es ? 'Sólo con enlace privado' : 'Private link only'}</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">{es ? 'Portada del enlace (opcional)' : 'Link cover (optional)'}
        <input ref={coverInput} className={`${control} max-w-full`} type="file" accept="image/png,image/jpeg,image/webp"
          disabled={busy} onChange={() => setRemoveCover(false)} />
      </label>
      {existing?.coverUrl && existing.profileId === profile.id && <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={removeCover} disabled={busy} onChange={event => {
          setRemoveCover(event.target.checked);
          if (event.target.checked && coverInput.current) coverInput.current.value = '';
        }} />{es ? 'Quitar portada' : 'Remove cover'}
      </label>}
      <button className={button} disabled={busy || !addresses || !slug || Boolean(existing && existing.profileId !== profile.id)}>
        {existing?.active ? (es ? 'Actualizar enlace' : 'Update link') : (es ? 'Publicar enlace' : 'Publish link')}
      </button>
    </form>}
    {!!addresses?.length && <ul className="space-y-2">
      {addresses.map(address => <li key={address.slug} className="flex flex-wrap items-center gap-2 text-sm">
        {library && <span className="text-text-muted">{projectTitles?.[address.projectId] ?? (es ? 'Proyecto fuera de la biblioteca' : 'Project outside the library')}</span>}
        {address.url ? <a className="break-all underline" href={address.url} target="_blank" rel="noreferrer">{address.url}</a>
          : <span>{address.slug} · {es ? 'Retirado' : 'Withdrawn'}</span>}
        {address.coverUrl && <a className="underline" href={address.coverUrl} target="_blank" rel="noreferrer">{es ? 'Ver portada' : 'View cover'}</a>}
        {profile?.id === address.profileId && <button type="button" className={button} disabled={busy} onClick={() => {
          setSlug(address.slug); setAudience(address.audience); setEditionId(address.editionId);
          setRemoveCover(false);
          if (coverInput.current) coverInput.current.value = '';
        }}>{es ? 'Usar esta ruta' : 'Use this path'}</button>}
        {address.active && <button type="button" className={button} disabled={busy} onClick={() => {
          void update(() => withdrawWikiAddress({ projectId: address.projectId, profileId: address.profileId, slug: address.slug, expectedRevision: address.revision }));
        }}>{es ? 'Retirar enlace' : 'Withdraw link'}</button>}
      </li>)}
    </ul>}
    {addresses?.length === 0 && library && <p className="text-sm text-text-muted">{es ? 'Todavía no hay enlaces publicados.' : 'There are no published links yet.'}</p>}
    {error && <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-sm text-danger">{error === 'wiki_host_conflict'
        ? (es ? 'La dirección ya está en uso o ha cambiado. Actualiza la lista.' : 'The address is in use or has changed. Refresh the list.')
        : error === 'wiki_host_cover_invalid'
        ? (es ? 'No se pudo usar la portada. Elige una imagen PNG, JPEG o WebP.' : 'Could not use the cover. Choose a PNG, JPEG or WebP image.')
        : (es ? 'No se pudo gestionar el enlace de la wiki.' : 'Could not manage the wiki link.')}</p>
      <button type="button" className={button} disabled={busy} onClick={() => setReload(value => value + 1)}>{es ? 'Actualizar lista' : 'Refresh list'}</button>
    </div>}
    </div>
  </details>;
}
