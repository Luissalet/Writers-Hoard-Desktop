// ctrl+↑ / ctrl+↓ on a selection, the way every image UI does it. Its own file
// because a module that exports both a component and a helper cannot be hot
// reloaded, and this helper is used by three text boxes in the composer.

import type { KeyboardEvent } from 'react';
import { WEIGHT_STEP, adjustWeight } from '../studio';

type TextControl = HTMLTextAreaElement | HTMLInputElement;

/**
 * ctrl+↑ / ctrl+↓ on a selection, the way every image UI does it.
 *
 * The selection is restored afterwards so the shortcut can be held: without it
 * the caret jumps to the end after the first press and the second press
 * weights whatever word happens to be there.
 */
export function onWeightKeyDown(
  event: KeyboardEvent<TextControl>,
  onChange: (text: string) => void,
): void {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  const field = event.currentTarget;
  const delta = event.key === 'ArrowUp' ? WEIGHT_STEP : -WEIGHT_STEP;
  const edit = adjustWeight(field.value, field.selectionStart ?? 0, field.selectionEnd ?? 0, delta);
  if (!edit) return;
  event.preventDefault();
  onChange(edit.text);
  window.requestAnimationFrame(() => {
    field.setSelectionRange(edit.start, edit.end);
  });
}

