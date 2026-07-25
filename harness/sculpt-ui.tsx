// Mounts the real SculptView in a browser so the WebGL path is exercised where
// it runs. Shipping an untested shader is how you ship a black rectangle.
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import SculptView from '../src/engines/worldgen/components/SculptView';
import { DEFAULT_PAINT_TOOL, type PaintTool } from '../src/engines/worldgen/components/PaintPanel';
import { PaintSession } from '../src/engines/worldgen/core/paintSession';
import type { WorldEdit } from '../src/engines/worldgen/core/edits';
import { unpackWorld, type WorldData, type WorldTransfer } from '../src/engines/worldgen/core/types';

declare global {
  interface Window {
    wgReady?: boolean; wgWorld?: WorldData; wgEdits?: number;
    wgLand?: () => number; wgSetTool?: (p: Partial<PaintTool>) => void;
  }
}

async function loadWorld(): Promise<WorldData> {
  const meta = await (await fetch('/world.json')).json();
  const buf = await (await fetch('/world.bin')).arrayBuffer();
  const t: Record<string, unknown> = { ...meta };
  let off = 0;
  for (const [name, len] of meta.__layout as [string, number][]) {
    if (name.startsWith('river:')) continue;
    t[name] = buf.slice(off, off + len); off += len;
  }
  const rivers: { cells: ArrayBuffer; flow: number }[] = [];
  for (const [name, len] of meta.__layout as [string, number][]) {
    if (!name.startsWith('river:')) continue;
    rivers.push({ cells: buf.slice(off, off + len), flow: meta.__riverFlows[rivers.length] });
    off += len;
  }
  t.rivers = rivers;
  return unpackWorld(t as unknown as WorldTransfer);
}

function App() {
  const [world, setWorld] = useState<WorldData | null>(null);
  const [tool, setTool] = useState<PaintTool>({ ...DEFAULT_PAINT_TOOL, mode: 'terrain', terrainOp: 'raise', radius: 14, strength: 0.9 });
  const [rev, setRev] = useState(0);
  const session = useRef<PaintSession | null>(null);

  useEffect(() => {
    void loadWorld().then((w) => {
      session.current = new PaintSession(w);
      window.wgWorld = w;
      window.wgLand = () => { let n = 0; for (let i = 0; i < w.width * w.height; i++) if (w.elevation[i] > 0) n++; return n; };
      window.wgSetTool = (p) => setTool((t) => ({ ...t, ...p }));
      setWorld(w);
      window.wgReady = true;
    });
  }, []);

  const onEdit = useCallback((e: WorldEdit) => {
    session.current?.push(e);
    window.wgEdits = session.current?.edits.length ?? 0;
    setRev((r) => r + 1);
  }, []);

  if (!world) return <div style={{ color: '#888', padding: 20 }}>cargando…</div>;
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#111' }}>
      <SculptView world={world} tool={tool} onEdit={onEdit} revision={rev} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
