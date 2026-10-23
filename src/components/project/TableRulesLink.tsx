// A way from the project settings to the table's rules (Sheets → Table rules).
// Kept apart so the settings form still works where there is no router.
import { useNavigate } from 'react-router-dom';

export default function TableRulesLink({ projectId, locale, beforeGo, disabled }: { projectId: string; locale: 'es' | 'en'; beforeGo: () => Promise<boolean>; disabled: boolean }) {
  const navigate = useNavigate(), es = locale === 'es';
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-elevated px-4 py-3">
    <p className="min-w-0 text-xs text-text-dim">{es ? 'Cómo juega vuestra mesa: sistema, reglas cambiadas y notas de la velada. Guarda tus cambios y las abre.' : 'How your table plays: system, changed rules and notes for the evening. Saves your changes and opens them.'}</p>
    <button type="button" data-testid="project-table-rules-link" disabled={disabled} onClick={() => void beforeGo().then(ok => { if (ok) navigate(`/project/${encodeURIComponent(projectId)}/character-sheets?view=rules`); })}
      className="flex-shrink-0 rounded-lg border border-accent-gold/40 px-3 py-1.5 text-sm font-medium text-accent-gold transition hover:bg-accent-gold/10 disabled:opacity-50">{es ? 'Reglas de la mesa' : 'Table rules'}</button>
  </div>;
}
