// ============================================================================
// Writing the training set to disk
// ============================================================================
//
// The bundle itself is decided by a pure function (`services/visualRef/dataset`);
// this is the half that touches bytes. It goes out as a ZIP the writer unpacks
// wherever their trainer lives, which is also the only shape available without
// a new file-system door in the main process — and a ZIP is what gets moved to
// the machine with the graphics card anyway.

import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { dataUrlToBlob } from '@/engines/_shared';
import type { DatasetBundle } from '@/services/visualRef';

/** Turn a bundle into archive bytes. Separated from saving so it can be tested. */
export async function buildDatasetArchive(bundle: DatasetBundle): Promise<Blob> {
  const zip = new JSZip();
  for (const file of bundle.images) {
    const { blob } = dataUrlToBlob(file.dataUrl);
    zip.file(file.path, blob);
  }
  for (const file of [...bundle.captions, ...bundle.configs, bundle.readme]) {
    zip.file(file.path, file.text);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** Build and hand the archive to the browser's download flow. */
export async function downloadDataset(bundle: DatasetBundle): Promise<void> {
  saveAs(await buildDatasetArchive(bundle), `${bundle.folder}.zip`);
}
