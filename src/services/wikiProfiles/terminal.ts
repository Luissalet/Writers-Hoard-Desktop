import type { WorldWikiOptions } from '@/types/worldWiki';

/**
 * Optional extras for the terminal and shell layouts of the exported wiki: phosphor
 * palettes, CRT scanlines, a dither filter for pictures, a boot line and an editable
 * "New here?" list of commands. All of it is off unless the profile asks for it, so a
 * profile without `terminal` exports exactly the bytes it did before. Nothing here
 * needs a network or a font download.
 */
export const WIKI_PHOSPHORS = {
  amber: { name: { es: 'Ámbar', en: 'Amber' }, paper: '#140c00', ink: '#ffb000', muted: '#d9962b', line: '#5c3d00', accent: '#ffd060', secondary: '#1f1400' },
  green: { name: { es: 'Verde', en: 'Green' }, paper: '#031207', ink: '#33ff66', muted: '#2ec25a', line: '#0f4a22', accent: '#9dffb8', secondary: '#07200f' },
  ice: { name: { es: 'Hielo', en: 'Ice' }, paper: '#04121a', ink: '#7fdcff', muted: '#58b3d6', line: '#124055', accent: '#c8f1ff', secondary: '#082230' },
  purple: { name: { es: 'Morado', en: 'Purple' }, paper: '#0f0720', ink: '#c79bff', muted: '#a77ae8', line: '#3a2370', accent: '#e6d0ff', secondary: '#190d33' },
  red: { name: { es: 'Rojo', en: 'Red' }, paper: '#1a0505', ink: '#ff5a4d', muted: '#e0594d', line: '#5a1a16', accent: '#ff9a90', secondary: '#2a0a09' },
} as const;
export type WikiPhosphor = keyof typeof WIKI_PHOSPHORS;
export interface WikiOpeningCommand { command: string; note?: string }
export interface WikiTerminalOptions { phosphor?: WikiPhosphor; scanlines?: boolean; dither?: boolean; bootLine?: string; opening?: WikiOpeningCommand[] }

export const WIKI_TERMINAL_LIMITS = { bootLine: 120, command: 60, note: 120, opening: 8 } as const;
/** The commands the console understands, as a starting point for the opening list. */
export const WIKI_DEFAULT_OPENING: readonly WikiOpeningCommand[] = [{ command: 'help' }, { command: 'list' }, { command: 'home' }];
const singleLine = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

export function validateWikiTerminal(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('wiki_terminal_invalid');
  const terminal = value as Record<string, unknown>;
  for (const key of Object.keys(terminal)) if (!['phosphor', 'scanlines', 'dither', 'bootLine', 'opening'].includes(key)) throw Error('wiki_terminal_invalid');
  if (terminal.phosphor !== undefined && (typeof terminal.phosphor !== 'string' || !Object.hasOwn(WIKI_PHOSPHORS, terminal.phosphor))) throw Error('wiki_terminal_invalid');
  for (const key of ['scanlines', 'dither']) if (terminal[key] !== undefined && typeof terminal[key] !== 'boolean') throw Error('wiki_terminal_invalid');
  if (terminal.bootLine !== undefined && !singleLine(terminal.bootLine, WIKI_TERMINAL_LIMITS.bootLine)) throw Error('wiki_terminal_invalid');
  if (terminal.opening !== undefined) {
    if (!Array.isArray(terminal.opening) || terminal.opening.length > WIKI_TERMINAL_LIMITS.opening) throw Error('wiki_terminal_invalid');
    const seen = new Set<string>();
    for (const item of terminal.opening) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('wiki_terminal_invalid');
      const { command, note, ...rest } = item as Record<string, unknown>;
      if (Object.keys(rest).length || !singleLine(command, WIKI_TERMINAL_LIMITS.command) || seen.has((command as string).trim()) || note !== undefined && !singleLine(note, WIKI_TERMINAL_LIMITS.note)) throw Error('wiki_terminal_invalid');
      seen.add((command as string).trim());
    }
  }
}

const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
/** The extras only exist on the two command-style layouts. */
export function wikiTerminalActive(options: WorldWikiOptions): WikiTerminalOptions | undefined {
  const terminal = options.terminal;
  if (!terminal || options.layout !== 'terminal' && options.layout !== 'shell') return undefined;
  return terminal.phosphor || terminal.scanlines || terminal.dither || terminal.bootLine?.trim() || terminal.opening?.length ? terminal : undefined;
}
export function wikiTerminalStyle(terminal: WikiTerminalOptions): string {
  const p = terminal.phosphor ? WIKI_PHOSPHORS[terminal.phosphor] : undefined;
  const phosphor = p ? `:root{color-scheme:dark;--paper:${p.paper};--ink:${p.ink};--muted:${p.muted};--line:${p.line};--accent:${p.accent};--secondary:${p.secondary}}header,button,input,select,.prose pre{background:var(--secondary);color:var(--ink)}button:hover{background:color-mix(in srgb,var(--ink) 14%,var(--secondary))}::selection{background:var(--ink);color:var(--paper)}` : '';
  const crt = terminal.scanlines ? `body{text-shadow:0 0 5px color-mix(in srgb,var(--ink) 30%,transparent)}body::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:60;background:repeating-linear-gradient(0deg,rgba(0,0,0,.16) 0,rgba(0,0,0,.16) 1px,transparent 1px,transparent 3px)}@media print{body::after{display:none}body{text-shadow:none}}` : '';
  const dither = terminal.dither ? `img.wiki-dither{image-rendering:pixelated}` : '';
  const boot = terminal.bootLine?.trim() ? `.wiki-boot{margin:0 0 16px;font-size:14px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}.wiki-boot::after{content:"\\2588";margin-left:6px;animation:wiki-blink 1.1s steps(1) infinite}@keyframes wiki-blink{50%{opacity:0}}@media(prefers-reduced-motion:reduce){.wiki-boot::after{animation:none}}@media print{.wiki-boot::after{content:none}}` : '';
  const opening = terminal.opening?.length ? `.wiki-opening{margin:16px 0}.wiki-opening h3{margin:0 0 8px;font-size:16px}.wiki-opening ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px 16px}.wiki-opening li{display:flex;align-items:center;gap:8px}.wiki-opening button{min-height:34px;padding:4px 10px}.wiki-opening span{color:var(--muted);font-size:13px}@media print{.wiki-opening{display:none}}` : '';
  return `${phosphor}${crt}${dither}${boot}${opening}`;
}
export function wikiTerminalBoot(terminal: WikiTerminalOptions): string {
  return terminal.bootLine?.trim() ? `<p class="wiki-boot">&gt; ${esc(terminal.bootLine.trim())}</p>` : '';
}
/** Buttons that run a command in the console form; shown only on the shell layout, which has the form. */
export function wikiTerminalOpening(terminal: WikiTerminalOptions, locale: 'es' | 'en'): string {
  if (!terminal.opening?.length) return '';
  return `<div class="wiki-opening"><h3>${locale === 'es' ? '¿Primera vez por aquí?' : 'New here?'}</h3><ul>${terminal.opening.map(item => `<li><button type="button" data-wiki-command="${esc(item.command.trim())}">${esc(item.command.trim())}</button>${item.note?.trim() ? `<span>${esc(item.note.trim())}</span>` : ''}</li>`).join('')}</ul></div>`;
}
/** Runs after the console script; reads only the page and the colours already in it. */
export function wikiTerminalScript(terminal: WikiTerminalOptions, shell: boolean): string {
  const open = shell && terminal.opening?.length ? `document.querySelectorAll('[data-wiki-command]').forEach(button=>button.addEventListener('click',()=>{const form=document.getElementById('wiki-command-form'),input=document.getElementById('wiki-command');if(!form||!input)return;input.value=button.getAttribute('data-wiki-command')||'';form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}))}));` : '';
  const dither = terminal.dither ? `try{const style=getComputedStyle(document.documentElement),hex=value=>{const text=value.trim();return/^#[0-9a-f]{6}$/i.test(text)?[1,3,5].map(i=>parseInt(text.slice(i,i+2),16)):null},a=hex(style.getPropertyValue('--paper')),b=hex(style.getPropertyValue('--ink'));if(a&&b){const grey=c=>c[0]*.299+c[1]*.587+c[2]*.114,dark=grey(a)<grey(b)?a:b,light=dark===a?b:a,bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5],run=image=>{if(image.dataset.wikiDithered||!image.naturalWidth||!image.naturalHeight)return;image.dataset.wikiDithered='1';const w=Math.min(image.naturalWidth,480),h=Math.max(1,Math.round(image.naturalHeight*w/image.naturalWidth)),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const context=canvas.getContext('2d');if(!context)return;context.drawImage(image,0,0,w,h);const frame=context.getImageData(0,0,w,h),data=frame.data;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,level=grey([data[i],data[i+1],data[i+2]])/255,on=level>(bayer[(y%4)*4+x%4]+.5)/16,color=on?light:dark;data[i]=color[0];data[i+1]=color[1];data[i+2]=color[2]}context.putImageData(frame,0,0);image.classList.add('wiki-dither');image.src=canvas.toDataURL('image/png')};document.querySelectorAll('img[src^="data:"]').forEach(image=>{if(image.complete)run(image);else image.addEventListener('load',()=>run(image),{once:true})})}}catch(error){}` : '';
  return open || dither ? `;(()=>{${open}${dither}})();` : '';
}
/** Merges a change into the terminal options and drops empty values, so an untouched profile stays free of the field. */
export function patchWikiTerminal(current: WikiTerminalOptions | undefined, patch: Partial<WikiTerminalOptions>): WikiTerminalOptions | undefined {
  const next: Record<string, unknown> = { ...current, ...patch };
  for (const key of Object.keys(next)) {
    const value = next[key];
    if (value === undefined || value === false || value === '' || Array.isArray(value) && !value.length) delete next[key];
  }
  return Object.keys(next).length ? next as WikiTerminalOptions : undefined;
}
