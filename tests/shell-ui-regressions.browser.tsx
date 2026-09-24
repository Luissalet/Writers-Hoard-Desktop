// Shell and shared-UI regressions found by the 2026-09-24 audit: Escape in a
// nested picker or crop overlay must not close the host modal, staged engine
// choices survive a project refresh, and Modal honours dismissible={false}.
//
//   xvfb-run -a npx electron scripts/run-focused-browser-tests.cjs \
//     tests/shell-ui-regressions.browser.tsx testShellUiRegressions 120000 --no-sandbox

import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/engines';
import Modal from '@/components/common/Modal';
import IconPicker from '@/components/common/IconPicker';
import ImagePreviewCrop from '@/components/common/ImagePreviewCrop';
import EngineManager from '@/components/project/EngineManager';
import { t } from '@/i18n/useTranslation';
import type { Project } from '@/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const wait = (ms = 80) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const escape = (target: EventTarget) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

export async function testShellUiRegressions(): Promise<string[]> {
  const passed: string[] = [];
  const host = document.getElementById('root')!;

  // 1. Escape in the IconPicker search closes the picker, not the host modal.
  {
    let closes = 0;
    function Harness() {
      const [icon, setIcon] = useState('');
      return (
        <Modal open onClose={() => { closes += 1; }} title="Host">
          <IconPicker value={icon} onChange={setIcon} />
        </Modal>
      );
    }
    const root = createRoot(host);
    await act(async () => { root.render(<Harness />); await wait(); });
    const trigger = document.querySelector<HTMLButtonElement>(`[role="dialog"] button[title="${t('common.pickIcon')}"]`);
    assert(trigger, 'icon picker trigger missing');
    await act(async () => { trigger.click(); await wait(150); });
    const search = document.querySelector<HTMLInputElement>(`[role="dialog"] input[placeholder="${t('common.searchIcons')}"]`);
    assert(search, 'icon picker search did not open');
    search.focus();
    await act(async () => { escape(search); await wait(); });
    assert(closes === 0, 'Escape in the icon picker closed the host modal');
    assert(!document.querySelector(`input[placeholder="${t('common.searchIcons')}"]`), 'icon picker stayed open');
    assert(document.activeElement === trigger, 'focus did not return to the icon picker trigger');
    await act(async () => { escape(trigger); await wait(); });
    assert(closes === 1, 'Escape with the picker closed must still close the modal');
    await act(async () => { root.unmount(); });
    passed.push('IconPicker Escape closes only the popover inside a Modal');
  }

  // 2. Escape in the crop overlay cancels the crop, not the modal under it.
  {
    let closes = 0;
    let cancels = 0;
    function Harness() {
      const [src, setSrc] = useState<string | null>(null);
      return (
        <Modal open onClose={() => { closes += 1; }} title="Codex form">
          <input id="form-field" defaultValue="unsaved" />
          <button id="open-crop" type="button" onClick={() => setSrc('data:image/gif;base64,R0lGODlhAQABAAAAACw=')}>crop</button>
          <ImagePreviewCrop imageSrc={src} onConfirm={() => setSrc(null)} onCancel={() => { cancels += 1; setSrc(null); }} />
        </Modal>
      );
    }
    const root = createRoot(host);
    await act(async () => { root.render(<Harness />); await wait(); });
    const opener = document.getElementById('open-crop') as HTMLButtonElement;
    opener.focus();
    await act(async () => { opener.click(); await wait(); });
    const dialogs = document.querySelectorAll('[role="dialog"]');
    assert(dialogs.length === 2, `expected modal + crop dialogs, found ${dialogs.length}`);
    const cancel = document.querySelector<HTMLButtonElement>(`button[aria-label="${t('common.cancel')}"]`);
    assert(cancel && document.activeElement === cancel, 'crop overlay did not take focus');
    assert(document.body.textContent?.includes(t('imageCrop.title')), 'crop title not localized');
    await act(async () => { escape(cancel); await wait(); });
    assert(cancels === 1, 'Escape did not cancel the crop');
    assert(closes === 0, 'Escape in the crop overlay closed the modal underneath');
    assert(document.getElementById('form-field'), 'form underneath was unmounted');
    assert(document.activeElement === opener, 'focus did not return to the opener after cancel');
    await act(async () => { root.unmount(); });
    passed.push('ImagePreviewCrop Escape cancels the crop and keeps the host Modal');
  }

  // 3. A project refresh while the Engine Manager is open keeps staged changes.
  {
    const base: Project = {
      id: 'audit-project', title: 'Audit', type: 'standalone', mode: 'essentials', color: '#c4973b',
      description: '', enabledEngines: ['writings', 'notes'], engineOrder: ['writings', 'notes'],
      status: 'draft', createdAt: 1, updatedAt: 1,
    };
    let saved: string[] | null = null;
    const root = createRoot(host);
    const render = (project: Project) => root.render(
      <EngineManager open project={project} onClose={() => {}} onUpdate={async ({ enabledEngines }) => { saved = enabledEngines; }} />,
    );
    await act(async () => { render(base); await wait(); });
    const disables = () => document.querySelectorAll<HTMLButtonElement>(`[role="dialog"] button[aria-label="${t('engines.disable')}"]`);
    assert(disables().length === 2, `expected 2 enabled engines, found ${disables().length}`);
    await act(async () => { disables()[1].click(); await wait(); });
    assert(disables().length === 1, 'toggle did not stage');
    // Same row, new object — what useProject hands down after any project write.
    await act(async () => { render({ ...base, updatedAt: 2 }); await wait(); });
    assert(disables().length === 1, 'a project refresh wiped the staged engine toggle');
    const save = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === t('common.save'));
    assert(save, 'save button missing');
    await act(async () => { save.click(); await wait(); });
    assert(JSON.stringify(saved) === JSON.stringify(['writings']), `saved ${JSON.stringify(saved)}`);
    await act(async () => { root.unmount(); });
    passed.push('EngineManager keeps staged toggles across a project refresh');
  }

  // 4. dismissible={false}: Escape and backdrop ignored, X still closes.
  {
    let closes = 0;
    const root = createRoot(host);
    await act(async () => { root.render(<Modal open dismissible={false} onClose={() => { closes += 1; }} title="Dirty"><input id="dirty" /></Modal>); await wait(); });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () => { escape(document.getElementById('dirty')!); await wait(); });
    const backdrop = dialog.parentElement!;
    await act(async () => { backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await wait(); });
    assert(closes === 0, 'non-dismissible modal closed on Escape/backdrop');
    await act(async () => { dialog.querySelector<HTMLButtonElement>(`button[aria-label="${t('common.close')}"]`)!.click(); await wait(); });
    assert(closes === 1, 'X did not close a non-dismissible modal');
    await act(async () => { root.render(<Modal open onClose={() => { closes += 1; }} title="Clean"><input id="clean" /></Modal>); await wait(); });
    await act(async () => { escape(document.getElementById('clean')!); await wait(); });
    assert(closes === 2, 'default modal no longer closes on Escape');
    await act(async () => { root.unmount(); });
    passed.push('Modal dismissible={false} blocks Escape/backdrop only; default unchanged');
  }

  return passed;
}
