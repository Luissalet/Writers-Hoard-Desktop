/** Clipboard events can only write synchronously. Rendered cell images keep their portable source here. */
export const sourceImageClipboardData=new WeakMap<HTMLElement,string>();
