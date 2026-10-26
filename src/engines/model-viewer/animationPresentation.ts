export interface AnimationPresentation { order?: number[]; labels?: Record<string, string> }
export type AnimationPresentationAction = { action: 'rename'; index: number; label: string } | { action: 'move'; index: number; position: number } | { action: 'reset' };

/** Portable indices address source clips, including duplicate or unnamed clips. */
export function validateAnimationPresentation(value: unknown, count: number): asserts value is AnimationPresentation | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'order' && key !== 'labels')) throw Error('model_animation_presentation_invalid');
  const { order, labels } = value as AnimationPresentation;
  if (order !== undefined && (!Array.isArray(order) || order.length !== count || new Set(order).size !== count || Array.from(order).some(index => !Number.isSafeInteger(index) || index < 0 || index >= count))) throw Error('model_animation_order_invalid');
  if (labels !== undefined && (!labels || typeof labels !== 'object' || Array.isArray(labels) || Object.entries(labels).some(([key, label]) => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= count || !Number.isSafeInteger(Number(key)) || typeof label !== 'string'))) throw Error('model_animation_labels_invalid');
}

export function animationPresentationRows(names: readonly string[], presentation?: AnimationPresentation) {
  validateAnimationPresentation(presentation, names.length);
  const order = presentation?.order ? [...presentation.order] : names.map((_, index) => index);
  return { order, clips: order.map(index => ({ index, name: names[index], label: presentation?.labels?.[String(index)] ?? (names[index] || `animation_${index}`) })) };
}

/** Undefined removes the optional sidecar; unchanged edits retain its exact form. */
export function changeAnimationPresentation(names: readonly string[], before: AnimationPresentation | undefined, change: AnimationPresentationAction): AnimationPresentation | undefined {
  validateAnimationPresentation(before, names.length);
  if (change.action === 'reset') return undefined;
  if (!Number.isSafeInteger(change.index) || change.index < 0 || change.index >= names.length) throw Error('model_animation_index_invalid');
  const labels = { ...before?.labels }, order = before?.order ? [...before.order] : names.map((_, index) => index);
  if (change.action === 'rename') {
    const label = change.label.trim(), key = String(change.index);
    if (label ? labels[key] === label : !Object.hasOwn(labels, key)) return before;
    if (label) labels[key] = label; else delete labels[key];
  } else {
    if (!Number.isSafeInteger(change.position) || change.position < 0 || change.position >= names.length) throw Error('model_animation_position_invalid');
    const position = order.indexOf(change.index); if (position === change.position) return before;
    order.splice(position, 1); order.splice(change.position, 0, change.index);
  }
  const next: AnimationPresentation = {};
  if (order.some((index, position) => index !== position)) next.order = order;
  if (Object.keys(labels).length) next.labels = labels;
  return Object.keys(next).length ? next : undefined;
}
