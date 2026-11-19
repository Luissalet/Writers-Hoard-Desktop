import { db } from '@/db';
import { describeFailure, FamilyActionError } from '@/services/familyBridge/actions';
import { callFamily } from '@/services/familyBridge/client';
import { dataUrlToPngBase64 } from '@/services/familyBridge/images';
import { FILE_PLACEHOLDER, MAX_FILES } from '@/services/familyBridge/protocol';
import type { ProductionDossier } from './dossier';

export interface DossierUndo {
  project: string;
  production: string;
  receipt: string;
}

export async function sendProductionDossier(dossier: ProductionDossier) {
  const references = dossier.references.filter(ref => ref.available);
  if (references.length > MAX_FILES) throw new FamilyActionError('too-many-files', 'The dossier exceeds the family bridge image limit.');
  const images = await db.inspirationImages.bulkGet(references.map(ref => ref.id));
  const files = [];
  const referenceFiles: Record<string, string> = Object.create(null);
  for (let i = 0; i < references.length; i++) {
    const image = images[i];
    const ref = references[i];
    if (image?.projectId !== dossier.project.id) {
      throw new FamilyActionError('reference-changed', `The approved reference "${ref.id}" changed. Compile the dossier again.`);
    }
    const original = image.imageDataOriginal || image.imageData;
    const base64 = await dataUrlToPngBase64(original);
    if (!base64) throw new FamilyActionError('bad-reference', `Could not read the approved image "${ref.id}".`);
    const id = `dossier-${i}`;
    files.push({ id, base64 });
    referenceFiles[ref.id] = `${FILE_PLACEHOLDER}${id}`;
  }

  const tool = 'production_receive_dossier';
  const response = await callFamily('prospero', tool, { dossier_json: JSON.stringify(dossier), reference_files: referenceFiles }, { files });
  if (!response.ok) throw describeFailure('prospero', tool, response);
  const result = response.result as {
    project_id: string; production: string; character_id?: string; existing: boolean;
    undo_receipt?: string; reference_assets: Record<string, string>;
  } | undefined;
  if (!result?.project_id || !result.production || (!result.existing && !result.undo_receipt)) {
    throw new FamilyActionError('bad-response', 'Prospero did not return a production and an undo receipt.');
  }
  const undo: DossierUndo | undefined = result.undo_receipt
    ? { project: result.project_id, production: result.production, receipt: result.undo_receipt } : undefined;
  return {
    projectId: result.project_id, production: result.production, existing: result.existing,
    characterId: result.character_id ?? null, referenceAssets: result.reference_assets,
    preserveDetails: dossier.preserveDetails, undo,
  };
}

export async function undoProductionHandoff(undo: DossierUndo): Promise<void> {
  const tool = 'production_discard_dossier';
  const response = await callFamily('prospero', tool, { ...undo });
  if (!response.ok) throw describeFailure('prospero', tool, response);
}

