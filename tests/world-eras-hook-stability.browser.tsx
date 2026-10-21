import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import { useEraWritingOperations, useEraSnapshotOperations } from '@/services/worldEras/writings';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
/** Pane geometry/focus updates must not reload a book, rebind saves or refile history. */
export async function testWorldEraHookStability(): Promise<string[]> {
  const root = createRoot(document.getElementById('root')!);
  let writing!: ReturnType<typeof useEraWritingOperations>, snapshots!: ReturnType<typeof useEraSnapshotOperations>, currentScope!: ReturnType<typeof useWorldEraScope>, effectRuns = 0;
  function Probe() {
    writing = useEraWritingOperations('stability-project'); snapshots = useEraSnapshotOperations('stability-project'); currentScope = useWorldEraScope('stability-project');
    useEffect(() => { effectRuns++; }, [writing.getWriting, writing.getWritings, writing.updateWritingAtVersion, snapshots.takeSnapshot, snapshots.ensureSnapshot, snapshots.readSnapshot, snapshots.listSnapshotMeta]);
    return null;
  }
  const render = async (eraId: string | undefined, width: number, visible: boolean) => act(async () => { root.render(<EnginePaneContext.Provider value={{ instanceId: 'pane', projectId: 'stability-project', eraId, width, visible }}><Probe /></EnginePaneContext.Provider>); });
  try {
    await render('past', 480, true);
    const oldWriting = writing, oldSnapshots = snapshots, oldScope = currentScope;
    for (const [width, visible] of [[640, true], [640, false], [1000, true]] as const) await render('past', width, visible);
    assert(writing === oldWriting && snapshots === oldSnapshots && currentScope === oldScope && effectRuns === 1, 'Resize/focus recreated operations and would re-run editor saves/history loads');
    await render('future', 1000, true);
    assert(writing !== oldWriting && snapshots !== oldSnapshots && currentScope.eraId === 'future' && effectRuns === 2, 'Era switch retained stale readers or save callbacks');
    await render(undefined, 1000, true);
    assert(!currentScope.eraId && effectRuns === 3, 'Returning to Base did not rebind scoped readers');
    return ['Memoized scope/read/write/snapshot callbacks survive pane resize and visibility changes; era switches rebind once without persistence'];
  } finally { await act(async () => root.unmount()); }
}
