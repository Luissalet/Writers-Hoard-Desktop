// ============================================
// Scrapper Engine — Instagram connect button
// ============================================
//
// Lets the user log into Instagram inside the app (embedded window). The app
// keeps only the session cookies, which yt-dlp / gallery-dl use to fetch
// photos and carousels. Desktop-only; renders nothing on the web build.

import { useEffect, useState } from 'react';
import { Instagram, Check, Loader2 } from 'lucide-react';
import { isDesktop } from '@/utils/platform';

export default function InstagramConnect() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI) {
      setConnected(false);
      return;
    }
    void window.electronAPI.instagram
      .status()
      .then((s) => setConnected(s.connected))
      .catch(() => setConnected(false));
  }, []);

  if (!isDesktop() || !window.electronAPI || connected === null) return null;

  const handleLogin = async () => {
    if (!window.electronAPI) return;
    setBusy(true);
    try {
      const r = await window.electronAPI.instagram.login();
      setConnected(r.connected);
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    if (!window.electronAPI) return;
    setBusy(true);
    try {
      await window.electronAPI.instagram.logout();
      setConnected(false);
    } finally {
      setBusy(false);
    }
  };

  return connected ? (
    <button
      onClick={handleLogout}
      disabled={busy}
      title="Instagram conectado — haz clic para desconectar"
      className="flex flex-shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-green-600/40 bg-green-600/10 text-green-400 hover:bg-green-600/20 transition-colors disabled:opacity-50"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
      Instagram
    </button>
  ) : (
    <button
      onClick={handleLogin}
      disabled={busy}
      title="Conecta tu Instagram para descargar fotos y carruseles"
      className="flex flex-shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border bg-elevated text-foreground hover:border-accent-gold transition-colors disabled:opacity-50"
    >
      {busy ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Instagram size={14} className="text-pink-500" />
      )}
      Conectar Instagram
    </button>
  );
}
