import { useLocaleStore, type Locale } from '@/stores/localeStore';
import es from '@/locales/es';
import en from '@/locales/en';

const locales: Record<Locale, Record<string, string>> = { es, en };

/**
 * Strings that load with a lazy chunk (an engine's own copy) instead of the
 * startup bundle. The main files win on a clash, so an engine can never
 * silently override shared copy.
 */
const extensions: Record<Locale, Record<string, string>> = { es: {}, en: {} };

export function registerLocaleStrings(bundle: Record<Locale, Record<string, string>>): void {
  for (const locale of Object.keys(extensions) as Locale[]) {
    Object.assign(extensions[locale], bundle[locale]);
  }
}

function lookup(locale: Locale, key: string): string {
  return locales[locale]?.[key] ?? extensions[locale]?.[key] ?? key;
}

/**
 * Non-reactive translation — use in services, callbacks, or outside React.
 * Reads the current locale from the store snapshot.
 */
export function t(key: string): string {
  const locale = useLocaleStore.getState().locale;
  return lookup(locale, key);
}

/**
 * Reactive hook — triggers re-render when locale changes.
 */
export function useTranslation() {
  const locale = useLocaleStore((s) => s.locale);

  const translate = (key: string): string => {
    return lookup(locale, key);
  };

  return { t: translate, locale };
}
