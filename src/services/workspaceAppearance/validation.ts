import { appearanceFonts, workspaceEffects, type WorkspaceAppearanceValues } from './types';
export const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;
export function validateRaster(value: string): string {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length > Math.ceil(MAX_BACKGROUND_BYTES / 3) * 4) throw Error('workspace_appearance_image_invalid');
  let bytes: string; try { bytes = atob(match[2]); } catch { throw Error('workspace_appearance_image_invalid'); }
  const valid = match[1] === 'png' ? bytes.startsWith('\x89PNG\r\n\x1a\n') : match[1] === 'jpeg' ? bytes.startsWith('\xff\xd8\xff') : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  if (!valid || bytes.length > MAX_BACKGROUND_BYTES) throw Error('workspace_appearance_image_invalid');
  return value;
}
export async function validateRasterImage(value: string): Promise<void> {
  validateRaster(value);
  await new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => image.naturalWidth && image.naturalHeight ? resolve() : reject(Error('workspace_appearance_image_invalid')); image.onerror = () => reject(Error('workspace_appearance_image_invalid')); image.src = value; });
}
export function normalizeAppearance(value: unknown): WorkspaceAppearanceValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('workspace_appearance_invalid');
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (key === 'mode' && (item === 'light' || item === 'dark')) result[key] = item;
    else if ((key === 'background' || key === 'accent') && typeof item === 'string' && /^#[\da-f]{6}$/i.test(item)) result[key] = item.toLowerCase();
    else if (key === 'proseFont' && item === 'reading') result[key] = item;
    else if ((key === 'uiFont' || key === 'proseFont') && typeof item === 'string' && Object.hasOwn(appearanceFonts, item)) result[key] = item;
    else if (key === 'backgroundImage' && (item === null || typeof item === 'string')) result[key] = item === null ? null : validateRaster(item);
    else if (key === 'grain' && typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 100) result[key] = Math.round(item);
    else if (key === 'performance' && typeof item === 'boolean') result[key] = item;
    else if (key === 'effect' && typeof item === 'string' && (workspaceEffects as readonly string[]).includes(item)) result[key] = item;
    else if (key === 'effectIntensity' && typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 100) result[key] = Math.round(item);
    else throw Error('workspace_appearance_invalid');
  }
  return result as WorkspaceAppearanceValues;
}
/** The metadata archive contract is synchronous and does not require a DOM. */
export function validateWorkspaceAppearanceProject(project: { workspaceAppearance?: unknown; worldEras?: readonly { workspaceAppearance?: unknown }[] }): void {
  for (const profile of [project.workspaceAppearance, ...(project.worldEras ?? []).map(era => era.workspaceAppearance)]) {
    if (profile === undefined) continue;
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) || Object.keys(profile).some(key => key !== 'revision' && key !== 'values')) throw Error('workspace_appearance_invalid');
    const record = profile as { revision?: unknown; values?: unknown };
    if (!Number.isSafeInteger(record.revision) || Number(record.revision) < 0) throw Error('workspace_appearance_revision_invalid');
    normalizeAppearance(record.values);
  }
}
