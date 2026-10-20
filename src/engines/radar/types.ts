export interface RadarAxis { id: string; label: string; min: number; max: number; unit: string }
export interface RadarSeries { id: string; name: string; color: string; values: Record<string, number>; visible?: boolean; linkedEntryId?: string; bindings?: Record<string, string> }
export interface RadarChartDocument { id: string; title: string; description: string; axes: RadarAxis[]; series: RadarSeries[]; revision: number; createdAt: number; updatedAt: number }
