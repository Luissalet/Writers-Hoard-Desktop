// Independent review regressions: versioned pin audio survives legacy import,
// and session undo must not reuse a revision accepted by an older receipt.
import { db } from '@/db';
import { remapImportedWorldMap } from '@/engines/maps/mapPortability';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import type { Project, WorldMap } from '@/types';

const assert = (value: unknown, message: string): void => { if (!value) throw new Error(message); };

export async function testReview1095d3(): Promise<string[]> {
  const passed: string[] = [], failures: string[] = [];
  try {
    const map = {
      id: 'review-map', projectId: 'original', title: 'Map', createdAt: 1, updatedAt: 1,
      ambience: { assetId: 'review-audio', volume: 0.6 },
      versions: [{ id: 'review-version', title: 'Earlier', features: [], pins: [{
        id: 'review-pin', projectId: 'original', mapId: 'review-map', name: 'Port',
        position: { x: 50, y: 50 }, ambience: { assetId: 'review-audio', volume: 0.4, radius: 12 },
      }] }],
    } as unknown as WorldMap;
    const copy = remapImportedWorldMap(map, 'copy', id => `copy-${id}`, new Set(), new Set(), new Set(['review-audio']));
    const audio = copy.versions![0].pins[0].ambience;
    assert(audio?.assetId === 'copy-review-audio' && audio.volume === 0.4 && audio.radius === 12,
      `Versioned pin must keep remapped audio: ${JSON.stringify(audio)}`);
    const missing = remapImportedWorldMap(map, 'copy', id => `copy-${id}`, new Set(), new Set(), new Set());
    assert(!missing.versions![0].pins[0].ambience, 'A versioned pin drops unavailable audio');
    passed.push('Legacy map import preserves versioned pin audio, volume and radius when the resource is imported; drops unavailable audio');
  } catch (error) { failures.push(String(error)); }

  const P = 'review-1095d3-session', O = `${P}-outline`;
  try {
    await db.projects.put({ id: P, title: 'Review QA', description: '', mode: 'custom', type: 'standalone',
      status: 'draft', color: '#999999', enabledEngines: ['outline'], engineOrder: [], createdAt: 1, updatedAt: 1 } as Project);
    await db.outlines.put({ id: O, projectId: P, title: 'Session', kind: 'session', sessionStatus: 'prep', sessionRevision: 1, createdAt: 1, updatedAt: 1 });
    const edit = await runBridgeTool('wh_session_set_status', { projectId: P, outlineId: O, status: 'next', expectedRevision: 1 });
    assert(edit.ok, `First session edit: ${JSON.stringify(edit)}`);
    const audit = (edit.result as { __audit: { before: unknown } }).__audit;
    const entry = { tool: 'wh_session_set_status', kind: 'update', entityId: O, projectId: P, before: audit.before };
    await undoAuditEntry({ entry });
    const undone = (await db.outlines.get(O))!;
    assert(undone.sessionStatus === 'prep', 'Session content restored');
    const stale = await runBridgeTool('wh_session_set_status', { projectId: P, outlineId: O, status: 'played', expectedRevision: 1 });
    assert(!stale.ok && stale.code === 'conflict', `The pre-edit revision must stay stale after undo: ${JSON.stringify(stale)}`);
    const later = await runBridgeTool('wh_session_set_status', { projectId: P, outlineId: O, status: 'played', expectedRevision: undone.sessionRevision });
    assert(later.ok, `Later session edit: ${JSON.stringify(later)}`);
    let refused = false;
    try { await undoAuditEntry({ entry }); } catch { refused = true; }
    assert(refused && (await db.outlines.get(O))?.sessionStatus === 'played', 'An older undo receipt cannot overwrite later work');
    passed.push('Session undo restores content with a fresh revision; stale writes and an old undo receipt cannot overwrite later work');
  } catch (error) { failures.push(String(error)); }
  finally { await db.outlines.delete(O); await db.projects.delete(P); }
  if (failures.length) throw new Error(failures.join('\n'));
  return passed;
}
