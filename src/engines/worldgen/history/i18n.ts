import { registerLocaleStrings } from '@/i18n/useTranslation';
import en from '../locales/en';
import es from '../locales/es';

// Imported for its side effect by the history panel, so the
// `worldgen.history.*` strings are in place before it renders.
registerLocaleStrings({ es, en });

export const historyActions = {
  es: { openRuinEvent: 'Ver el acontecimiento', openRealmCard: 'Abrir la ficha del reino' },
  en: { openRuinEvent: 'View the event', openRealmCard: 'Open the realm card' },
};

export const historyPinNotes: Record<'es' | 'en', Record<string, string>> = {
  es: {
    'outside-span': 'Este hecho queda fuera del periodo simulado.',
    'absent-today': 'Este reino no figura en el mapa del ?ltimo a?o.',
    'realm-protected': 'Otro hecho fijado mantiene en pie al reino que tiene aqu? su sede.',
    'earlier-fall': 'Otro hecho fija la ca?da de este lugar en una fecha igual o anterior.',
  },
  en: {
    'outside-span': 'This fact is outside the simulated span.',
    'absent-today': 'This realm is absent from the map in the final year.',
    'realm-protected': 'Another fixed fact keeps the realm seated here standing.',
    'earlier-fall': 'Another fact fixes this place?s fall on the same date or earlier.',
  },
};

/** `{name}` placeholders filled in. */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
