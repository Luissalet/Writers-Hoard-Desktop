// Mounts the REAL CartoMap and PaintPanel in a browser so the painting gesture is
// tested where it actually runs. Everything the app provides around them (routing,
// Tailwind, the worker) is stubbed; the components under test are untouched.
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import CartoMap from '../src/engines/worldgen/components/CartoMap';
import PaintPanel, { DEFAULT_PAINT_TOOL, type PaintTool } from '../src/engines/worldgen/components/PaintPanel';
import { PaintSession } from '../src/engines/worldgen/core/paintSession';
import type { WorldEdit } from '../src/engines/worldgen/core/edits';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import { getGeography } from '../src/engines/worldgen/cartography/texture';
import { unpackWorld, type WorldData, type WorldTransfer } from '../src/engines/worldgen/core/types';
import type { HumanGeography } from '../src/engines/worldgen/core/settlements';

declare global {
  interface Window {
    wgReady?: boolean;
    wgEdits?: number;
    wgWorld?: WorldData;
    wgLandCells?: () => number;
    wgSetTool?: (patch: Partial<PaintTool>) => void;
  }
}

async function loadWorld(): Promise<WorldData> {
  const meta = await (await fetch('/world.json')).json();
  const buf = await (await fetch('/world.bin')).arrayBuffer();
  const t: Record<string, unknown> = { ...meta };
  let off = 0;
  for (const [name, len] of meta.__layout as [string, number][]) {
    if (name.startsWith('river:')) continue;
    t[name] = buf.slice(off, off + len);
    off += len;
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
  const [geo, setGeo] = useState<HumanGeography | null>(null);
  const [tool, setTool] = useState<PaintTool>({ ...DEFAULT_PAINT_TOOL });
  const [rev, setRev] = useState(0);
  const session = useRef<PaintSession | null>(null);

  useEffect(() => {
    void loadWorld().then((w) => {
      session.current = new PaintSession(w);
      window.wgWorld = w;
      window.wgLandCells = () => {
        let n = 0;
        for (let i = 0; i < w.width * w.height; i++) if (w.elevation[i] > 0) n++;
        return n;
      };
      setWorld(w);
      setGeo(getGeography(w));
      window.wgReady = true;
    });
  }, []);

  useEffect(() => {
    window.wgSetTool = (patch) => setTool((t) => ({ ...t, ...patch }));
  }, []);

  const onEdit = useCallback((e: WorldEdit) => {
    const s = session.current;
    if (!s || !world) return;
    s.push(e);
    setGeo(getGeography(world));
    setRev((r) => r + 1);
    window.wgEdits = s.edits.length;
  }, [world]);

  if (!world || !geo) return <div style={{ color: '#888', padding: 20 }}>cargando…</div>;
  return (
    <div style={{ display: 'flex', height: '100vh', background: '#1a1a1f' }}>
      <div style={{ position: 'relative', flex: 1 }}>
        <CartoMap
          world={world}
          theme={themeById('wonder')}
          geography={geo}
          layers={{ frame: false, compass: false, scaleBar: false }}
          density={1}
          reliefAmount={1}
          paint={tool}
          onEdit={onEdit}
        />
      </div>
      <aside style={{ width: 300, padding: 12, overflowY: 'auto', borderLeft: '1px solid #333' }}>
        <PaintPanel
          tool={tool}
          onChange={setTool}
          strokeCount={session.current?.edits.length ?? 0}
          canUndo={!!session.current?.canUndo}
          canRedo={!!session.current?.canRedo}
          onUndo={() => { session.current?.undo(); setGeo(getGeography(world)); setRev((r) => r + 1); }}
          onRedo={() => { session.current?.redo(); setGeo(getGeography(world)); setRev((r) => r + 1); }}
          onClear={() => { session.current?.clear(); setGeo(getGeography(world)); setRev((r) => r + 1); }}
          cellKm={Math.round(40075 / world.width)}
        />
        <div id="rev" style={{ color: '#8f8', fontSize: 11, marginTop: 8 }}>rev {rev}</div>
      </aside>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
