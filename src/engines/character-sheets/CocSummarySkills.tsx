import type { PanelProps } from './StatsPanel';
import { COC_SUMMARY_SKILL_SLOTS } from './cocTypes';
import { button } from './uiStyles';

export default function CocSummarySkills({ sheet, locale, update }: Pick<PanelProps, 'sheet' | 'locale' | 'update'>) {
  const es = locale === 'es', selected = sheet.coc?.summarySkillIds ?? [];
  const missing = selected.filter(id => !sheet.skills.some(row => row.id === id));
  const choose = (id: string, checked: boolean) => update(current => {
    const ids = current.coc?.summarySkillIds ?? [];
    if (checked && (ids.includes(id) || ids.length >= COC_SUMMARY_SKILL_SLOTS)) return current;
    return { ...current, coc: { ...current.coc!, summarySkillIds: checked ? [...ids, id] : ids.filter(value => value !== id) } };
  });
  return <details className="rounded-lg border border-border p-4" data-testid="coc-summary-skills"><summary className="cursor-pointer text-sm text-accent-gold">{es ? 'Habilidades destacadas' : 'Featured skills'} · {selected.length} / {COC_SUMMARY_SKILL_SLOTS}</summary>
    <p className="mt-3 text-sm text-text-muted">{es ? 'Elige hasta cinco para el resumen, en el orden en que las marques. No son las marcas de mejora. Guarda la ficha para mostrarlas en Investigadores.' : 'Choose up to five for the summary, in the order you select them. These are separate from development marks. Save the sheet to show them in Investigators.'}</p>
    <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">{sheet.skills.map(skill => <label key={skill.id} className="flex min-h-9 min-w-0 items-center gap-2 text-sm text-text-primary"><input type="checkbox" aria-label={`${es ? 'Destacar' : 'Feature'} ${skill.label}`} checked={selected.includes(skill.id)} disabled={!selected.includes(skill.id) && selected.length >= COC_SUMMARY_SKILL_SLOTS} onChange={event => choose(skill.id, event.target.checked)}/><span className="break-words">{skill.label}</span></label>)}</div>
    {missing.map(id => <p key={id} className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-muted">{es ? 'Habilidad seleccionada no disponible' : 'Selected skill unavailable'}<button type="button" className={button} onClick={() => choose(id, false)}>{es ? 'Quitar del resumen' : 'Remove from summary'}</button></p>)}
    {sheet.coc?.summarySkillIds !== undefined && <button type="button" className={`${button} mt-3`} onClick={() => update(current => { const coc = { ...current.coc! }; delete coc.summarySkillIds; return { ...current, coc }; })}>{es ? 'Restablecer selección sin configurar' : 'Reset to unconfigured selection'}</button>}
  </details>;
}
