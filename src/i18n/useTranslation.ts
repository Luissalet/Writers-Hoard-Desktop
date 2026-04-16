import es from '@/locales/es';

export function t(key: string): string {
  return (es as Record<string, string>)[key] ?? key;
}

export function useTranslation() {
  return { t };
}
