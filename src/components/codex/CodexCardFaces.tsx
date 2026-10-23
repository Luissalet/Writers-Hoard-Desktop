// The faces of a card: what it is (fields, text, images, connections), the
// stat blocks and sheets made for it, and the notes about it — one tab each,
// showing only the faces the card has.
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CodexEntry, Project } from '@/types';
import { sheetPaper } from '@/engines/character-sheets/paper';
import { useTranslation } from '@/i18n/useTranslation';

type Face = 'about' | 'statblock' | 'sheet' | 'notes';

export default function CodexCardFaces({ entry, project, about, notes }: { entry: CodexEntry; project: Pick<Project, 'id' | 'characterSheets'> | null | undefined; about: ReactNode; notes: ReactNode }) {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const [face, setFace] = useState<Face>('about');
  const sheets = (project?.characterSheets ?? []).filter(sheet => sheet.linkedEntryId === entry.id);
  const statBlocks = sheets.filter(sheet => sheet.preset === '5e-stat-block'), playSheets = sheets.filter(sheet => sheet.preset !== '5e-stat-block');
  const faces: Face[] = ['about', ...(statBlocks.length ? ['statblock' as const] : []), ...(playSheets.length ? ['sheet' as const] : []), 'notes'];
  const shown = faces.includes(face) ? face : 'about';
  const papers = (list: typeof sheets) => list.map(sheet => {
    const paper = sheetPaper(sheet, locale === 'es' ? 'es' : 'en');
    return <figure key={sheet.id} className="space-y-2" data-testid={`codex-face-paper-${sheet.id}`}>
      <figcaption className="flex items-center justify-between gap-2 text-sm text-text-muted"><span>{sheet.title}</span>
        <button type="button" className="text-xs text-accent-gold underline underline-offset-2" onClick={() => navigate(`/project/${encodeURIComponent(entry.projectId)}/character-sheets?entity=${encodeURIComponent(sheet.id)}`)}>{t('codex.faces.openSheet')}</button></figcaption>
      {/* The paper is drawn by the sheet engine from the sheet's own values, every text escaped. */}
      <div className="overflow-hidden rounded-lg border border-border bg-white" dangerouslySetInnerHTML={{ __html: paper.svg }} />
    </figure>;
  });
  return <div className="space-y-4" data-testid="codex-card-faces">
    <div role="tablist" aria-label={t('codex.faces.label')} className="flex flex-wrap gap-1 border-b border-border">
      {faces.map(item => <button key={item} type="button" role="tab" aria-selected={shown === item} data-testid={`codex-face-${item}`} onClick={() => setFace(item)}
        className={`-mb-px rounded-t-lg border px-3 py-1.5 text-sm ${shown === item ? 'border-border border-b-transparent bg-surface text-accent-gold' : 'border-transparent text-text-muted hover:text-text-primary'}`}>
        {t(`codex.faces.${item}`)}{item === 'statblock' && statBlocks.length > 1 ? ` (${statBlocks.length})` : item === 'sheet' && playSheets.length > 1 ? ` (${playSheets.length})` : ''}
      </button>)}
    </div>
    <div role="tabpanel" className="space-y-4">
      {shown === 'about' && about}
      {shown === 'statblock' && papers(statBlocks)}
      {shown === 'sheet' && papers(playSheets)}
      {shown === 'notes' && notes}
    </div>
  </div>;
}
