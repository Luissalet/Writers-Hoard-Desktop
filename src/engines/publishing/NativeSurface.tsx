import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import libraryStyles from './native/library/index.css?inline';
import linksStyles from './native/links/index.css?inline';
import paperworkStyles from './native/paperwork/index.css?inline';
import paperworkTheme from './native/paperwork/hoard-theme.css?inline';
import { setNativeRoute } from './navigation';

const Library = lazy(() => import('./native/library/App.jsx'));
const Links = lazy(() => import('./native/links/App.jsx'));
const Paperwork = lazy(() => import('./native/paperwork/App.jsx'));
const Editorial = lazy(() => import('./EditorialSurface'));
const styles: Record<string, string> = { library: libraryStyles, links: linksStyles, paperwork: paperworkTheme + paperworkStyles };

export default function NativeSurface({ module }: { module: string }) {
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => setRoot(node ? node.shadowRoot || node.attachShadow({ mode: 'open' }) : null), []);
  useEffect(() => {
    if (!root) return;
    const navigate = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest('a') : null;
      const href = target?.getAttribute('href');
      if (!href?.startsWith('#')) return;
      event.preventDefault();
      if (href.startsWith('#/')) setNativeRoute(module, href);
      else root.getElementById(href.slice(1))?.scrollIntoView();
    };
    root.addEventListener('click', navigate);
    return () => root.removeEventListener('click', navigate);
  }, [root, module]);
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    if (module === 'library' || module === 'paperwork') {
      const load = module === 'library' ? import('./native/library/copilot-context.js') : import('./native/paperwork/copilot-context.js');
      void load.then(native => { if (!cancelled) cleanup = native.installCopilot(); });
    }
    return () => { cancelled = true; cleanup?.(); };
  }, [module]);
  return <div ref={attach} className="min-h-0 flex-1 overflow-auto" data-hoard-app="writer" data-writer-module={module}>
    {root && createPortal(<><style>{(styles[module] || '').replaceAll(':root', ':host').replace(/\bhtml\b/g, ':host').replace(/\bbody\b/g, ':host')}</style><div id="root" data-writer-native={module}><Suspense fallback={<p>…</p>}>{module === 'library' ? <Library /> : module === 'links' ? <Links /> : module === 'paperwork' ? <Paperwork /> : <Editorial />}</Suspense></div></>, root)}
  </div>;
}
