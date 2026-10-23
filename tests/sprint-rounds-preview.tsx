import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import SprintControl from '@/engines/writings/components/SprintControl';
import { useLocaleStore } from '@/stores/localeStore';
import { ToastHost } from '@/components/common/toast';
import '@/index.css';

// The clock is the page's own, moved forward by the runner: a 25-minute sprint
// and a 5-minute break are walked through in seconds.
const P = 'sprint-rounds-preview';
type Window = typeof window & { __spError?: string; __spReady?: boolean; __skew: number; __words: number; __spMount: () => void; __spUnmount: () => void };
const host = window as Window;
host.__skew = 0; host.__words = 1000;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + host.__skew;
const words = () => host.__words;
let root: Root | null = null;
host.__spMount = () => {
  root = createRoot(document.getElementById('root')!);
  root.render(<div className="min-h-screen bg-deep p-6 text-text-primary"><div className="flex justify-end"><SprintControl projectId={P} getProjectWords={words} /></div><ToastHost /></div>);
};
host.__spUnmount = () => { root?.unmount(); root = null; };
async function preview() {
  useLocaleStore.setState({ locale: 'es' });
  await db.projects.put({ id: P, title: 'Rondas', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 });
  host.__spMount();
  host.__spReady = true;
}
void preview().catch(error => { host.__spError = String(error?.stack ?? error); });
