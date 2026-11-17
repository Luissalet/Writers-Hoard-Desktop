import type { WorldDate } from '@/engines/timeline/worldCalendar';
import type { FogOp } from '../core/readerFog';
import type { RoutePoint } from '../core/tradeRoutes';

export const PLATE_FORMATS = ['png', 'svg', 'pdf'] as const;
export type PlateFormat = typeof PLATE_FORMATS[number];

export interface KnowledgeMark extends RoutePoint {
  /** Source cells, so the correction follows terrain when a finite sheet grows. */
  radius: number;
  op: FogOp;
}

export type CartographerOrigin = { kind: 'culture'; id: string } | { kind: 'place'; id: string };

export interface InWorldMap {
  id: string;
  title: string;
  origin: CartographerOrigin;
  date: WorldDate;
  reach: number;
  distortion: number;
  themeId: string;
  chapter?: number;
  entryId?: string;
  marks: KnowledgeMark[];
}
