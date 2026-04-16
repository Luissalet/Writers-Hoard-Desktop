import { useLocaleStore, type Locale } from '@/stores/localeStore';
import es from '@/locales/es';
import en from '@/locales/en';

const locales: Record<Locale, Record<string, string>> = { es, en };

/**
 * Non-reactive translation — use in services, callbacks, or outside React.
 * Reads the current locale from the store snapshot.
 */
export function t(key: string): string {
  const locale = useLocaleStore.getState().locale;
  return locales[locale]?.[key] ?? key;
}

/**
 * Reactive hook — triggers re-render when locale changes.
 */
export function useTranslation() {
  const locale = useLocaleStore((s) => s.locale);

  const translate = (key: string): string => {
    return locales[locale]?.[key] ?? key;
  };

  return { t: translate, locale };
}
