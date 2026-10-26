import { assertWorldEra } from '@/services/worldEras/store';
import { requireString, optString, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { fitTimelineViewport, timelineViewportTargets } from './viewport';
async function scopeFor(args: ToolArgs) { const scope = { projectId: requireString(args, 'projectId'), eraId: optString(args, 'eraId') }; await assertWorldEra(scope); return scope; }
export async function whTimelineViewGet(args: ToolArgs) { const scope = await scopeFor(args); return { ...scope, targets: timelineViewportTargets(scope) }; }
export async function whTimelineViewFit(args: ToolArgs) { return fitTimelineViewport(await scopeFor(args), requireString(args, 'hostId')); }
