import type { RadarChartDocument } from './types';
import { createRadarChart, RADAR_COLORS, cloneRadarChart } from './model';
export const RADAR_SKELETONS = [
  { id: 'character', en: 'Character profile', es: 'Perfil de personaje', axes: [['Strength', 'Fuerza', 'BicepsFlexed'], ['Insight', 'Perspicacia', 'Eye'], ['Influence', 'Influencia', 'Users'], ['Agility', 'Agilidad', 'Footprints'], ['Resolve', 'Voluntad', 'Shield']] },
  { id: 'location', en: 'Location profile', es: 'Perfil de lugar', axes: [['Population', 'Población', 'Users'], ['Prosperity', 'Prosperidad', 'Coins'], ['Defenses', 'Defensas', 'Shield'], ['Resources', 'Recursos', 'Trees'], ['Access', 'Acceso', 'Route']] },
  { id: 'faction', en: 'Faction profile', es: 'Perfil de facción', axes: [['Reach', 'Alcance', 'Globe'], ['Wealth', 'Riqueza', 'Coins'], ['Knowledge', 'Conocimiento', 'BookOpen'], ['Cohesion', 'Cohesión', 'Users'], ['Force', 'Fuerza', 'Swords']] },
] as const;
export function radarFromSkeleton(id: string, locale: 'es' | 'en'): RadarChartDocument {
  const skeleton = RADAR_SKELETONS.find(item => item.id === id); if (!skeleton) throw new Error('radar_preset_missing');
  const chart = createRadarChart(skeleton[locale]); chart.presetCategory = skeleton.id;
  chart.axes = chart.axes.map((axis, index) => ({ ...axis, label: skeleton.axes[index][locale === 'es' ? 1 : 0], icon: skeleton.axes[index][2], color: RADAR_COLORS[index % RADAR_COLORS.length], step: 1 }));
  return chart;
}
export function radarFromPreset(preset: RadarChartDocument): RadarChartDocument {
  return { ...cloneRadarChart(preset, preset.title, true), isPreset: false };
}
