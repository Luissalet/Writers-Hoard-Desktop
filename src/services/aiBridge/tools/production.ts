import { compileProductionDossier, type DossierInput } from '@/services/production/dossier';
import { sendProductionDossier } from '@/services/production/handoff';
import { FamilyActionError } from '@/services/familyBridge/actions';
import { BridgeError, optEnum, optString, optStringArray, requireString, resolveProjectId, withAudit, type ToolArgs } from './shared';

function input(args: ToolArgs): DossierInput {
  return {
    projectId: resolveProjectId(args),
    eraId: optString(args, 'eraId'),
    writingId: requireString(args, 'writingId'),
    kind: optEnum(args, 'kind', ['character', 'scene', 'place'] as const) ?? 'scene',
    subjectId: optString(args, 'subjectId'),
    placeId: optString(args, 'placeId'),
    preserveDetails: optStringArray(args, 'preserveDetails'),
  };
}

export async function whProductionDossier(args: ToolArgs) {
  return compileProductionDossier(input(args));
}

export async function whProductionToProspero(args: ToolArgs) {
  const dossier = await whProductionDossier(args);
  try {
    const { undo, ...sent } = await sendProductionDossier(dossier);
    return withAudit({ ...sent, created: Boolean(undo) }, {
      projectId: dossier.project.id, entityId: sent.production, kind: 'create',
      summary: `sent dossier "${dossier.title}" to a production draft`,
      ...(undo ? { before: { __productionHandoff: undo } } : { reversible: false as const }),
    });
  } catch (error) {
    if (error instanceof FamilyActionError) throw new BridgeError(error.code, error.message);
    throw error;
  }
}

