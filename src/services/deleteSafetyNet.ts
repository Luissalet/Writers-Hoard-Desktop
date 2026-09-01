// ============================================================================
// The last copy — a project's archive, written before the project is destroyed
// ============================================================================
//
// Deleting a project is the most destructive thing this app can do, and until
// now it was also the least protected: one confirm dialog stood between a
// writer and a novel that no longer existed anywhere. Every other destructive
// act has a way back — a deleted chapter has its Undo bar and its whole version
// history, a restored project has the archive it came from — but a deleted
// project had nothing. There is no trash, no retention window, and no undo.
//
// This gives it one, and deliberately not by inventing a trash:
//
//   A TRASH IS A PROMISE THE APP CANNOT KEEP. Rows kept "for thirty days" still
//   live in the same IndexedDB the browser is allowed to evict, still count
//   against the same quota, and still have to be swept by every future
//   migration, export and delete path. Worse, a writer who knows there is a
//   trash stops keeping their own copies.
//
//   A FILE IS A PROMISE IT CAN. The app already knows how to write a project's
//   whole archive to disk without a save dialog (`backup.writeArchive`, the
//   same door the automatic backup uses), and it already knows how to read one
//   back — the ZIP restore, which is now reliable enough to be worth pointing
//   a writer at. So the safety net is a real file, in a folder they can open,
//   in the one format the app can restore.
//
// It is BEST EFFORT and says so. A delete the writer asked for happens whether
// or not the copy could be written; what changes is that they are told which of
// the two they got. Silently deleting after a failed copy would be worse than
// the situation this replaces, because the writer would believe a copy exists.

import { db } from '@/db';
import { createProjectZipArchive } from './zipBackup';

/** How many farewell copies the folder keeps before the oldest is rotated out. */
const FAREWELL_COPIES = 20;

/**
 * The name the folder will show. It has to satisfy `BACKUP_DELETED_NAME` in
 * electron/main.ts exactly — that pattern is the entire security boundary on a
 * channel that writes bytes to disk with no dialog — so the title is reduced to
 * lowercase ASCII and hyphens here rather than trusted through.
 *
 * A title that reduces to nothing (one written in a non-Latin script, or only
 * punctuation) simply leaves the slug out. The timestamp is what makes the name
 * unique; the slug only saves the writer from opening twenty archives to find
 * the right one.
 */
export function farewellFileName(title: string, when: Date): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  const stamp = new Date(when.getTime() - when.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace(/:/g, '-');
  return `writers-hoard-deleted-${slug ? `${slug}-` : ''}${stamp}.zip`;
}

export interface FarewellArchiveResult {
  /** True only when the bytes reached the disk. */
  saved: boolean;
  /** Where it landed, when the platform told us. */
  path?: string;
  /** Why it did not, for the log — never shown raw to the writer. */
  error?: string;
}

/**
 * Write one project's archive to the backup folder, and say whether it worked.
 *
 * Never throws. The caller is on its way to delete a project the writer has
 * already confirmed; an exception here would either abort a delete they asked
 * for or, worse, be swallowed and leave them thinking a copy exists.
 *
 * Returns `saved: false` unchanged on the web build, where there is no folder
 * to write to — the caller says so rather than pretending.
 */
export async function archiveProjectBeforeDelete(
  projectId: string,
): Promise<FarewellArchiveResult> {
  const bridge = window.electronAPI?.backup;
  if (!bridge?.writeArchive) {
    return { saved: false, error: 'no-desktop-bridge' };
  }

  try {
    const project = await db.projects.get(projectId);
    const { blob } = await createProjectZipArchive(projectId);
    const result = await bridge.writeArchive(
      await blob.arrayBuffer(),
      farewellFileName(project?.title ?? '', new Date()),
      FAREWELL_COPIES,
    );
    if (!result?.ok) {
      return { saved: false, error: result?.code ?? 'write-failed' };
    }
    return { saved: true, path: result.path };
  } catch (error) {
    return { saved: false, error: error instanceof Error ? error.message : String(error) };
  }
}
