/** Same address entry semantics as the existing rich HTML editor. */
export function normalizeEditorLinkHref(value:string):string|null {
 const url=value.trim();return url?/^(https?:|mailto:)/i.test(url)?url:`https://${url}`:null;
}
