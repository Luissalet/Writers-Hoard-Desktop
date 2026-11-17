// The history lens: settings from the world row, the history worked out off
// the click while the tab is open, the chosen year and its borders.

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { useWorldCalendar } from '@/engines/timeline/useWorldCalendar';
import { formatWorldDate } from '@/engines/timeline/worldCalendar';
import { useTranslation } from '@/i18n/useTranslation';
import type { HumanGeography } from '../core/settlements';
import type { WorldData } from '../core/types';
import type { GeneratedWorld } from '../types';
import type { HistoryLayer } from '../cartography/historyLayer';
import { historyInputFrom } from './fromGeography';
import { simulateHistory } from './simulate';
import { historyRecordOf, type WorldHistoryRecord } from './store';
import { territoryAt } from './territory';
import { historyNames, type HistoryNames } from './text';
import type { HistoryInput, WorldHistory } from './types';
import { fill } from './i18n';

export interface WorldHistoryLens {
  record: WorldHistoryRecord;
  input: HistoryInput | null;
  history: WorldHistory | null;
  names: HistoryNames | null;
  year: number;
  setYear: (year: number) => void;
  focus: string | null;
  setFocus: (key: string | null) => void;
  layer: HistoryLayer | undefined;
  /** Waiting for the full geography (ruins, roads) or for the simulation. */
  pending: boolean;
  enabledEngines: string[];
}

export function useWorldHistory(projectId: string, world: GeneratedWorld, data: WorldData | null, geography: HumanGeography | null, open: boolean): WorldHistoryLens {
  const { t } = useTranslation();
  const row = useLiveQuery(() => db.generatedWorlds.get(world.id), [world.id]);
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const calendar = useWorldCalendar(projectId)?.calendar ?? null;
  const record = useMemo(() => historyRecordOf(row ?? world), [row, world]);
  const settingsKey = JSON.stringify(record.settings);
  const [state, setState] = useState<{ key: string; data: WorldData; geo: HumanGeography; input: HistoryInput; history: WorldHistory } | null>(null);
  const ready = open && !!data && !!geography && geography.depth === 'full' && geography.settlements.length > 0;
  useEffect(() => {
    if (!ready || !data || !geography) return;
    if (state && state.key === settingsKey && state.data === data && state.geo === geography) return;
    let live = true;
    const timer = window.setTimeout(() => {
      if (!live) return;
      const input = historyInputFrom(data, geography);
      setState({ key: settingsKey, data, geo: geography, input, history: simulateHistory(input, record.settings) });
    }, state ? 250 : 30);
    return () => { live = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settingsKey stands for record.settings; `state` only picks the delay.
  }, [ready, data, geography, settingsKey]);
  const current = state && state.data === data && state.geo === geography ? state : null;
  const history = current?.history ?? null;
  const [year, setYearRaw] = useState(record.settings.endYear);
  const setYear = (y: number) => setYearRaw(Math.round(y));
  useEffect(() => {
    if (!history) return;
    setYearRaw((y) => Math.min(history.endYear, Math.max(history.startYear, y)));
  }, [history]);
  const [focus, setFocus] = useState<string | null>(null);
  const names = useMemo(() => {
    if (!current) return null;
    const fmt = (y: number) => {
      if (calendar) { try { return formatWorldDate(calendar, { year: y }); } catch { /* outside the calendar: plain year */ } }
      return fill(t('worldgen.history.yearN'), { n: y });
    };
    return historyNames(current.history, [...current.input.places, ...current.input.ruins], current.input.languages, fmt);
  }, [current, calendar, t]);
  const layer = useMemo<HistoryLayer | undefined>(() => {
    if (!open || !current) return undefined;
    const raster = territoryAt(current.input, current.history, year);
    const byKey = new Map(current.history.polities.map((p) => [p.key, p]));
    return {
      raster,
      hues: raster.polities.map((k) => byKey.get(k)?.hue ?? 0),
      names: raster.polities.map((k) => byKey.get(k)?.name ?? k),
      ...(focus ? { focus } : {}),
    };
  }, [open, current, year, focus]);
  return {
    record, input: current?.input ?? null, history, names, year, setYear, focus, setFocus, layer,
    pending: open && (!ready || !current || current.key !== settingsKey),
    enabledEngines: project?.enabledEngines ?? [],
  };
}
