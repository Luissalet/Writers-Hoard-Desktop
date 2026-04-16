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

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: 'es',
  loaded: false,

  setLocale: async (locale: Locale) => {
    set({ locale });
    await setSetting(SETTING_KEY, locale);
  },

  loadLocale: async () => {
    const saved = await getSetting(SETTING_KEY);
    if (saved === 'en' || saved === 'es') {
      set({ locale: saved, loaded: true });
    } else {
      set({ loaded: true });
    }
  },
}));
