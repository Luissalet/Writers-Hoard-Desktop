export const appearanceFonts = {
  incumbent: "'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
  system: "system-ui, 'Segoe UI', Arial, sans-serif",
  serif: "'Iowan Old Style', Charter, Georgia, 'Times New Roman', serif",
  humanist: "Candara, 'Trebuchet MS', 'Segoe UI', sans-serif",
  classic: "Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif",
  mono: "ui-monospace, Consolas, 'Liberation Mono', monospace",
} as const;
export type AppearanceFont = keyof typeof appearanceFonts;
export const workspaceEffects = ['none', 'snow', 'rain', 'embers', 'fireflies'] as const;
export type WorkspaceEffect = typeof workspaceEffects[number];
export interface WorkspaceAppearanceValues {
  mode?: 'dark' | 'light'; background?: string; accent?: string;
  uiFont?: AppearanceFont; proseFont?: AppearanceFont | 'reading';
  /** Embedded raster bytes: survives offline project archives without an external path. */
  backgroundImage?: string | null; grain?: number; performance?: boolean;
  effect?: WorkspaceEffect; effectIntensity?: number;
}
export interface WorkspaceAppearance { revision: number; values: WorkspaceAppearanceValues }
export interface AppearanceScope { projectId: string; eraId?: string }
export interface AppearanceRead extends AppearanceScope { revision: number; own: WorkspaceAppearanceValues; effective: WorkspaceAppearanceValues; inherited: boolean }
