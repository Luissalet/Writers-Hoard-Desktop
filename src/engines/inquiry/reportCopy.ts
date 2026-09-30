import { t } from '@/i18n/useTranslation';
import { REPORT_COPY_KEYS, type ReportCopy } from './report';
import './i18n';

/** The report's wording in the current language. `translate` is injectable for tests. */
export function buildReportCopy(translate: (key: string) => string = t): ReportCopy {
  return Object.fromEntries(REPORT_COPY_KEYS.map(key => [key, translate(`inquiry.report.${key}`)])) as ReportCopy;
}
