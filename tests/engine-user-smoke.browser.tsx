import { Component, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { getAllEngines } from '@/engines';

/** Run only in an isolated browser profile; never against the author's DB. */
export async function testEngineUserSmoke(): Promise<string[]> {
  const errors: string[] = [];
  const results: string[] = [];
  const onError = (event: ErrorEvent) => errors.push(event.error?.stack ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => errors.push(String(event.reason?.stack ?? event.reason));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  const projectId = `engine-smoke-${Date.now()}`;
  const now = Date.now();
  const engines = getAllEngines();
  await db.projects.add({ id: projectId, title: 'Engine startup fixture', description: '', type: 'standalone', status: 'draft', mode: 'custom', color: '#c4973b', enabledEngines: engines.map((engine) => engine.id), engineOrder: engines.map((engine) => engine.id), createdAt: now, updatedAt: now });
  class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(error: Error) { errors.push(error.stack ?? error.message); }
    render() { return this.state.failed ? <p data-smoke-error>Render failed</p> : this.props.children; }
  }
  const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  try {
    for (const engine of engines) {
      const host = document.createElement('main');
      host.style.cssText = 'height:850px;width:1100px;overflow:auto';
      host.dataset.engineSmoke = engine.id;
      document.body.append(host);
      const root = createRoot(host);
      const startErrors = errors.length;
      const View = engine.component;
      root.render(<MemoryRouter initialEntries={[`/project/${projectId}/${engine.id}`]}><Boundary><Suspense fallback={<span data-smoke-pending>Loading</span>}><View projectId={projectId} /></Suspense></Boundary></MemoryRouter>);
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        await pause(50);
        if (errors.length > startErrors) break;
        if (host.childElementCount && !host.querySelector('[data-smoke-pending]')) break;
      }
      await pause(600);
      const content = (host.textContent ?? '').replace(/\s+/g, ' ').trim();
      const empty = !host.childElementCount || Boolean(host.querySelector('[data-smoke-pending]'));
      root.unmount();
      host.remove();
      await pause(50);
      if (errors.length > startErrors) throw new Error(`${engine.id}: ${errors.slice(startErrors).join('\n')}`);
      if (empty) throw new Error(`${engine.id}: engine never finished mounting`);
      results.push(`${engine.id}: ${content.slice(0, 140) || '(canvas mounted)'}`);
      console.log(`[engine-smoke] ${results[results.length - 1]}`);
    }
    return results;
  } finally {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  }
}
