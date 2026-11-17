// "Update the outline from the chapter": the author accepts a beat's proposal;
// the beat's title and description change through the outline's own writer,
// and the receipt puts them back.
import { db } from '@/db';
import { updateBeat } from '@/engines/outline/operations';

export interface DriftReceipt { beatId: string; before: { title: string; description: string }; after: { title: string; description: string } }

export async function applyBeatProposal(projectId: string, beatId: string, proposal: { title: string; description: string }): Promise<DriftReceipt> {
  const beat = await db.outlineBeats.get(beatId);
  if (!beat || beat.projectId !== projectId) throw new Error(`No outline beat "${beatId}" in this project.`);
  const after = { title: proposal.title.trim().slice(0, 300) || beat.title, description: proposal.description.trim().slice(0, 5000) };
  const before = { title: beat.title, description: beat.description ?? '' };
  await updateBeat(beatId, after);
  return { beatId, before, after };
}

/** Undo: put the beat's words back, if nobody changed them since. */
export async function revertBeatProposal(projectId: string, receipt: DriftReceipt): Promise<void> {
  const beat = await db.outlineBeats.get(receipt.beatId);
  if (!beat || beat.projectId !== projectId) throw new Error('The outline beat is gone.');
  if (beat.title !== receipt.after.title || (beat.description ?? '') !== receipt.after.description) throw new Error('The beat changed again since; undo the later change first.');
  await updateBeat(receipt.beatId, receipt.before);
}
