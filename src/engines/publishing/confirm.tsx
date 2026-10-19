import { createRoot } from 'react-dom/client';
import { ConfirmDialog } from '@/engines/_shared';

export function nativeConfirm(message: string): Promise<boolean> {
  return new Promise(resolve => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const finish = (answer: boolean) => {
      resolve(answer);
      queueMicrotask(() => { root.unmount(); host.remove(); });
    };
    root.render(<ConfirmDialog open message={message} destructive onConfirm={() => finish(true)} onCancel={() => finish(false)} />);
  });
}
