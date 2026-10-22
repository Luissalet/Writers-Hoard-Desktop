import { formatDuration, travelEstimates } from '@/engines/real-atlas/geo';
import { useTranslation } from '@/i18n/useTranslation';

/** How long a distance takes on foot, on horseback and by carriage (the pre-industrial ways). */
export default function MapTravelReadout({ km, testId }: { km: number; testId?: string }) {
  const { t, locale } = useTranslation();
  const rows = travelEstimates(km).filter(row => row.mode === 'walk' || row.mode === 'horse' || row.mode === 'carriage');
  return <table className="w-full text-[11px]" data-testid={testId}><tbody>{rows.map(row => <tr key={row.mode} className="border-t border-border/60">
    <td className="py-0.5 text-text-muted">{t(`realAtlas.map.travel.${row.mode}`)}</td>
    <td className="py-0.5 text-right font-mono text-text-primary">{formatDuration(row.hours, locale)}</td>
    <td className="py-0.5 pl-2 text-right text-text-dim">{row.days === undefined ? '' : row.days === 1 ? t('realAtlas.map.measure.stagesOne') : t('realAtlas.map.measure.stages').replace('{count}', String(row.days))}</td>
  </tr>)}</tbody></table>;
}
