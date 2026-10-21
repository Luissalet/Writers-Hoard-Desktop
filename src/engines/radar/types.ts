export interface RadarAxis { id: string; label: string; min: number; max: number; unit: string; step?: number; icon?: string; color?: string }
export interface RadarSeries { id: string; name: string; color: string; values: Record<string, number>; visible?: boolean; linkedEntryId?: string; bindings?: Record<string, string> }
export interface RadarChartDocument { id: string; title: string; description: string; axes: RadarAxis[]; series: RadarSeries[]; isPreset?: boolean; presetCategory?: string; revision: number; createdAt: number; updatedAt: number }
