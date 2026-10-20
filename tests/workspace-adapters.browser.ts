import { db } from '@/db';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import { registerFallbackAnchorAdapters } from '@/engines/_shared/anchoring/registerFallbackAdapters';
import '@/engines/writings';
import '@/engines/codex';
import '@/engines/maps';
import '@/engines/worldgen';
import '@/engines/dictionary';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function testWorkspaceAdapters(): Promise<string[]> {
  const P = `pane-adapter-${Date.now()}`, M = `${P}-map`, routes: string[] = [], navigate = (route: string) => { routes.push(route); };
  try {
    await db.worldMaps.put({ id: M, projectId: P, title: 'Map', createdAt: 1, updatedAt: 1 });
    getAnchorAdapter('writings')!.navigateToEntity('chapter', P, navigate);
    getAnchorAdapter('codex')!.navigateToEntity('card', P, navigate);
    getAnchorAdapter('maps')!.navigateToEntity(M, P, navigate);
    registerFallbackAnchorAdapters(); getAnchorAdapter('dictionary')!.navigateToEntity('word', P, navigate);
    for (let i = 0; i < 100 && routes.length < 4; i++) await new Promise(resolve => setTimeout(resolve, 15));
    assert(routes.includes(`/project/${P}/writings?writing=chapter`) && routes.includes(`/project/${P}/codex?entry=card`) && routes.includes(`/project/${P}/maps?map=${M}`) && routes.includes(`/project/${P}/dictionary?entity=word`), 'Named, asynchronous map and fallback anchor adapters must use the supplied scoped navigator');
    return ['Pane anchor adapters: chapters, Codex, async map resolution and fallback dictionary routes use the supplied navigator instead of the global router'];
  } finally { await db.worldMaps.delete(M); }
}
