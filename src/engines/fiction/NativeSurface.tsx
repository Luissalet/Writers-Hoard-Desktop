import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import App, { type Theme } from './native/App';
import styles from './native/styles/global.css?inline';
import { installCopilot } from './native/lib/copilot';

// Shadow styles keep the incorporated views' selectors and theme local to this
// engine. React remains in Writer's tree; there is no frame or second UI server.
export default function NativeSurface() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    setRoot(node ? node.shadowRoot || node.attachShadow({ mode: 'open' }) : null);
  }, []);
  useEffect(() => installCopilot(), []);
  return <div ref={attach} className="min-h-0 flex-1" data-hoard-app="writer" data-theme={theme}>
    {root && createPortal(<><style>{styles}</style><App onTheme={setTheme} /></>, root)}
  </div>;
}
