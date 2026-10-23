import { folderTree, readWorkspaceLibrary } from '@/components/project/workspace/library/model';
import type { Project } from '@/types';

const control = 'min-h-10 min-w-0 w-full rounded border border-border bg-elevated px-3 py-2 text-sm text-text-primary focus-visible:outline-accent-gold';

/** Picks the Library folder the imported documents are filed in ("" = the Library root). */
export default function LibraryFolderSelect({ project, value, onChange, es, disabled }: { project: Project | undefined; value: string; onChange: (folderId: string) => void; es: boolean; disabled?: boolean }) {
  const folders = project ? folderTree(readWorkspaceLibrary(project).folders) : [];
  return <label className="grid min-w-40 flex-1 gap-1 text-xs text-text-muted">{es ? 'Carpeta de la biblioteca' : 'Library folder'}
    <select className={control} data-testid="world-folder-library-folder" aria-label={es ? 'Carpeta de destino en la biblioteca' : 'Destination folder in the library'} disabled={disabled} value={folders.some(item => item.folder.id === value) ? value : ''} onChange={event => onChange(event.target.value)}>
      <option value="">{es ? 'Sin carpeta (raíz de la biblioteca)' : 'No folder (library root)'}</option>
      {folders.map(({ folder, depth }) => <option key={folder.id} value={folder.id}>{`${' '.repeat(depth)}${folder.name}`}</option>)}
    </select>
  </label>;
}
