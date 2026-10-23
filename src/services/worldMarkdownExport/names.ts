// ============================================
// World Markdown export — safe, unique file names and relative paths
// ============================================

const FORBIDDEN = /[\p{Cc}<>:"/\\|?*#^[\]]+/gu;
// Windows reserves these names whatever comes after the first dot ("con.txt" is the console device).
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[\d¹²³]|lpt[\d¹²³])$/i;

/** A name every desktop file system and every Markdown reader accepts as a link target. */
export function safeName(title: string, fallback = 'Untitled', max = 80): string {
  let name = (title ?? '').normalize('NFC').replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (name.length > max) name = name.slice(0, max).replace(/[. ]+$/, '');
  if (!name) name = fallback;
  const dot = name.indexOf('.'), base = dot < 0 ? name : name.slice(0, dot);
  if (WINDOWS_RESERVED.test(base.trim())) name = `${base}_${name.slice(base.length)}`;
  return name;
}

/** Hands out names that never repeat (case-insensitively) inside one scope. */
export class NameRegistry {
  private readonly taken = new Set<string>();
  constructor(reserved: readonly string[] = []) { for (const name of reserved) this.taken.add(name.toLowerCase()); }
  take(title: string, fallback?: string): string {
    const base = safeName(title, fallback);
    let candidate = base;
    for (let n = 2; this.taken.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})`;
    this.taken.add(candidate.toLowerCase());
    return candidate;
  }
}

/** `a/b/c.md` seen from `a/x/y.md` is `../../b/c.md`; every segment is URL-encoded. */
export function relativePath(fromFile: string, to: string): string {
  const from = fromFile.split('/').slice(0, -1);
  const target = to.split('/');
  let shared = 0;
  while (shared < from.length && shared < target.length - 1 && from[shared] === target[shared]) shared++;
  const up = from.slice(shared).map(() => '..');
  return [...up, ...target.slice(shared)].map(part => (part === '..' ? part : encodeURIComponent(part))).join('/');
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
