import { registerLocaleStrings } from '@/i18n/useTranslation';
import en from '../locales/en';
import es from '../locales/es';

// Imported for its side effect by the history panel, so the
// `worldgen.history.*` strings are in place before it renders.
registerLocaleStrings({ es, en });

/** `{name}` placeholders filled in. */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
