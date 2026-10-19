import { useEffect, useRef } from 'react';
import html from '../../../publishing/editorial/gutenberg_hoard/static/index.html?raw';
import theme from './native/library/hoard-theme.css?inline';
import css from '../../../publishing/editorial/gutenberg_hoard/static/style.css?inline';
import overrides from '../../../publishing/editorial/gutenberg_hoard/static/overrides.css?inline';
import ownerTheme from './editorial-theme.css?inline';
import { mountEditorial } from './editorial.js';

const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/src="\/static\/icon.png[^"]*"/g, 'src="/app-icon.png"').replace('Gutenberg</strong>', 'Maquetación</strong>').replace('PUBLICATION DESK', 'Writer');
// Keep React from replacing the editor's imperative DOM on owner rerenders.
const markup = { __html: body };
export default function EditorialSurface() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current ? mountEditorial(ref.current) : undefined, []);
  return <><style>{(theme + css + overrides + ownerTheme).replaceAll(':root', ':host').replace(/\bbody\b/g, ':host')}</style><div ref={ref} dangerouslySetInnerHTML={markup} /></>;
}
