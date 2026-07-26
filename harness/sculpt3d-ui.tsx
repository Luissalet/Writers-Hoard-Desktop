// Mounts the real Sculpt3D in a browser so the WebGL path is exercised where it
// runs. Shipping an untested shader is how you ship a black rectangle — and this
// one has two shaders, a vertex displacement, a ray march and a UV window, none of
// which a type checker can say anything about.
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Sculpt3D from '../src/engines/worldgen/components/Sculpt3D';
import { DEFAULT_PAINT_TOOL, type PaintTool } from '../src/engines/worldgen/components/PaintPanel';
import { PaintSession } from '../src/engines/worldgen/core/paintSession';
import type { WorldEdit } from '../src/engines/worldgen/core/edits';
import { unpackWorld, type WorldData, type WorldTransfer } from '../src/engines/worldgen/core/types';

declare global {
  interface Window {
    wgReady?: boolean; wgWorld?: WorldData; wgEdits?: number;
    wgLand?: () => number; wgSetTool?: (p: Partial<PaintTool>) => void;
    wgSum?: () => number; wgUndo?: () => void; wgSteps?: () => number;
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
  const [tool, setTool] = useState<PaintTool>({
    ...DEFAULT_PAINT_TOOL, mode: 'terrain', terrainOp: 'raise', radius: 14, strength: 0.9,
  });
  const [rev, setRev] = useState(0);
  const session = useRef<PaintSession | null>(null);

  useEffect(() => {
    void loadWorld().then((w) => {
      session.current = new PaintSession(w);
      window.wgWorld = w;
      window.wgLand = () => { let n = 0; for (let i = 0; i < w.width * w.height; i++) if (w.elevation[i] > 0) n++; return n; };
      window.wgSum = () => { let s = 0; for (let i = 0; i < w.width * w.height; i++) s += w.elevation[i]; return Math.round(s); };
      window.wgSetTool = (p) => setTool((t) => ({ ...t, ...p }));
      window.wgUndo = () => { session.current?.undo(); setRev((r) => r + 1); };
      window.wgSteps = () => session.current?.edits.length ?? 0;
      setWorld(w);
      window.wgReady = true;
    });
  }, []);

  const onEdits = useCallback((es: WorldEdit[]) => {
    session.current?.pushMany(es);
    window.wgEdits = session.current?.edits.length ?? 0;
    setRev((r) => r + 1);
  }, []);
  const onEdit = useCallback((e: WorldEdit) => onEdits([e]), [onEdits]);

  if (!world) return <div style={{ color: '#888', padding: 20 }}>cargando…</div>;
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#111' }}>
      <Sculpt3D
        world={world}
        tool={tool}
        onEdit={onEdit}
        onEdits={onEdits}
        onTool={(p) => setTool((t) => ({ ...t, ...p }))}
        revision={rev}
      />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
