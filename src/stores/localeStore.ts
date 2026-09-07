import { create } from 'zustand';
import { getSetting, setSetting } from '@/db/operations';

export type Locale = 'es' | 'en';

interface LocaleState {
  locale: Locale;
  loaded: boolean;
  setLocale: (locale: Locale) => Promise<void>;
  loadLocale: () => Promise<void>;
}

const SETTING_KEY = 'ui_language';

/** Follow the first supported browser language; Spanish is the product fallback. */
function detectSystemLocale(): Locale {
  if (typeof navigator === 'undefined') return 'es';
  for (const language of navigator.languages?.length
    ? navigator.languages
    : [navigator.language]) {
    const base = language.toLowerCase().split('-')[0];
    if (base === 'es' || base === 'en') return base;
  }
  return 'es';
}

function applyDocumentLocale(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

const initialLocale = detectSystemLocale();
applyDocumentLocale(initialLocale);

let preferenceRevision = 0;
let localeRead: Promise<void> | null = null;

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: initialLocale,
  loaded: false,

  setLocale: async (locale) => {
    preferenceRevision += 1;
    set({ locale, loaded: true });
    applyDocumentLocale(locale);
    await setSetting(SETTING_KEY, locale);
  },

  loadLocale: async () => {
    if (localeRead) return localeRead;
    const revisionAtStart = preferenceRevision;
    localeRead = getSetting(SETTING_KEY)
      .then((saved) => {
        if (revisionAtStart !== preferenceRevision) return;
        const locale = saved === 'en' || saved === 'es' ? saved : detectSystemLocale();
        set({ locale, loaded: true });
        applyDocumentLocale(locale);
      })
      .catch(() => {
        if (revisionAtStart !== preferenceRevision) return;
        set({ loaded: true });
        applyDocumentLocale(initialLocale);
      });
    return localeRead;
  },
}));
