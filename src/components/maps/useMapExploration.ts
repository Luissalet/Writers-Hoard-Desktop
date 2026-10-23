import { useMemo, useState } from 'react';
import type { MapExploration, MapPoint } from '@/types';
import {
  DEFAULT_BRUSH_RADIUS, DEFAULT_SIGHT_RADIUS, EXPLORATION_COLS, decodeMask, explorationRows, exploredPercent, fogOf, paintCircle, readExploration,
  type ExplorationIntent, type MaskCells, type MapFog, type RevealOp,
} from './mapExploration';

const MAX_STROKE_OPS = 2000;

export interface MapExplorationOptions {
  /** The map's stored record (any shape: it is checked before use). */
  exploration?: unknown;
  /** Picture height over width. */
  aspect: number;
  readOnly: boolean;
  /** Persists one intent against the record as it is then; absent = the fog cannot be edited here. */
  onChange?: (intent: ExplorationIntent, aspect: number) => void | Promise<void>;
}

interface Stroke { cells: MaskCells; ops: RevealOp[]; last: MapPoint; value: 0 | 1 }

/** State and gestures of the fog panel: brush, party marker, player view. */
export function useMapExploration({ exploration, aspect, readOnly, onChange }: MapExplorationOptions) {
  const record: MapExploration | undefined = useMemo(() => readExploration(exploration), [exploration]);
  const saved = useMemo(() => (record ? decodeMask(record) : null), [record]);
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<'reveal' | 'hide'>('reveal');
  const [brush, setBrush] = useState(false);
  const [radius, setRadius] = useState(DEFAULT_BRUSH_RADIUS);
  const [sightDraft, setSight] = useState<number | null>(null);
  const [trail, setTrail] = useState(false);
  const [session, setSession] = useState('');
  const [players, setPlayers] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stroke, setStroke] = useState<Stroke | null>(null);
  const [drag, setDrag] = useState<MapPoint | null>(null);
  const [cursor, setCursor] = useState<MapPoint | null>(null);

  const cols = record?.cols ?? EXPLORATION_COLS, rows = record?.rows ?? explorationRows(aspect);
  const base = useMemo(() => saved ?? new Uint8Array(cols * rows), [saved, cols, rows]);
  const cells = stroke?.cells ?? base;
  const editable = !readOnly && !!onChange;
  const sight = sightDraft ?? record?.party?.sightRadius ?? DEFAULT_SIGHT_RADIUS;

  const commit = async (intent: ExplorationIntent) => {
    if (!onChange) return;
    setBusy(true); setFailed(false);
    try { await onChange(intent, aspect); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  };

  const brushActive = open && editable && brush && !players;
  const beginStroke = (at: MapPoint) => {
    if (!brushActive) return;
    const value = tool === 'reveal' ? 1 : 0, cellsCopy = new Uint8Array(base);
    paintCircle(cellsCopy, cols, rows, at.x, at.y, radius, value);
    setStroke({ cells: cellsCopy, ops: [{ op: tool, x: at.x, y: at.y, radius }], last: at, value });
  };
  const moveStroke = (at: MapPoint) => {
    setCursor(at);
    setStroke(previous => {
      if (!previous || previous.ops.length >= MAX_STROKE_OPS) return previous;
      // Stamps closer than a third of the brush add nothing the last stamp did not cover.
      if (Math.hypot(at.x - previous.last.x, (at.y - previous.last.y) * aspect) < radius / 3) return previous;
      const next = new Uint8Array(previous.cells);
      paintCircle(next, cols, rows, at.x, at.y, radius, previous.value);
      return { ...previous, cells: next, ops: [...previous.ops, { op: previous.value ? 'reveal' : 'hide', x: at.x, y: at.y, radius }], last: at };
    });
  };
  const endStroke = async () => {
    const current = stroke;
    if (!current) return;
    // The stroke stays on screen until the saved record arrives, so the picture does not flicker back.
    await commit({ kind: 'brush', ops: current.ops });
    setStroke(null);
  };
  const cancelStroke = () => setStroke(null);

  const movePartyTo = async (at: MapPoint) => {
    await commit({ kind: 'party', move: { x: at.x, y: at.y, sightRadius: sight, trail, session } });
    setDrag(null);
  };

  const playersFog: MapFog | null = players ? fogOf(record) : null;
  const layerOn = !!record && (record.enabled || open) || !!stroke;
  const showParty = !!record?.party && (record.enabled || open);

  return {
    record, open, setOpen, tool, setTool, brush, setBrush, radius, setRadius, sight, setSight, trail, setTrail, session, setSession,
    players, setPlayers, placing, setPlacing, busy, failed, stroke, drag, setDrag, cursor, setCursor,
    cols, rows, cells, editable, brushActive, placeActive: open && editable && placing && !players,
    beginStroke, moveStroke, endStroke, cancelStroke, movePartyTo, commit,
    playersFog, layerOn, opacity: players ? 1 : 0.55, showParty, partyAt: drag ?? (record?.party ? { x: record.party.x, y: record.party.y } : null),
    percent: exploredPercent(cells),
  };
}
