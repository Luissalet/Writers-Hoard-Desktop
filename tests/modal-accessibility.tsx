import { useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConfirmDialog } from '@/engines/_shared';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function wait(ms = 20): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function testAccessibleModalContract(): Promise<string[]> {
  const host = document.getElementById('root');
  assert(host, 'critical harness root is missing');
  let root: Root | null = null;
  let resolveSubmit!: () => void;
  let submitCount = 0;
  const submission = new Promise<void>((resolve) => { resolveSubmit = resolve; });

  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button id="modal-invoker" type="button" onClick={() => setOpen(true)}>Open</button>
        <ConfirmDialog
          open={open}
          title="Safe question"
          message="Choose deliberately"
          destructive
          onCancel={() => setOpen(false)}
          onConfirm={async () => {
            submitCount += 1;
            await submission;
            setOpen(false);
          }}
        />
      </>
    );
  }

  try {
    await act(async () => {
      root = createRoot(host);
      root.render(<Harness />);
    });
    const invoker = document.getElementById('modal-invoker') as HTMLButtonElement | null;
    assert(invoker, 'modal invoker did not render');
    invoker.focus();
    await act(async () => { invoker.click(); await wait(); });

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    assert(dialog, 'modal has no dialog role');
    assert(dialog.getAttribute('aria-modal') === 'true', 'modal is not announced as modal');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    assert(labelledBy && document.getElementById(labelledBy)?.textContent === 'Safe question', 'dialog title is not associated');
    assert(host.inert && host.getAttribute('aria-hidden') === 'true', 'background was not made inert');

    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    assert(buttons.length === 3, `expected close, cancel and confirm controls, got ${buttons.length}`);
    const [close, cancel, confirm] = buttons;
    assert(document.activeElement === cancel, 'destructive confirmation did not focus Cancel');

    confirm.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    assert(document.activeElement === close, 'Tab escaped the end of the dialog');
    close.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    assert(document.activeElement === confirm, 'Shift+Tab escaped the start of the dialog');

    await act(async () => {
      confirm.click();
      confirm.click();
      await Promise.resolve();
    });
    assert(submitCount === 1, `double confirmation submitted ${submitCount} times`);
    assert(dialog.getAttribute('aria-busy') === 'true', 'busy submission is not announced');
    resolveSubmit();
    await act(async () => { await submission; await wait(180); });
    assert(!host.inert && host.getAttribute('aria-hidden') === null, 'background stayed inert after close');
    assert(document.activeElement === invoker, 'focus did not return to the invoking control');

    invoker.focus();
    await act(async () => { invoker.click(); await wait(); });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(180);
    });
    assert(document.querySelector('[role="dialog"]') === null, 'Escape did not close the top dialog');
    assert(document.activeElement === invoker, 'Escape did not restore focus');

    return ['Accessible modal: semantics, inert background, focus trap/restore and single submit'];
  } finally {
    if (root) await act(async () => { root?.unmount(); });
    host.replaceChildren();
  }
}
