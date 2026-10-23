import { renderToStaticMarkup } from 'react-dom/server';
import type { CocSummary } from './cocSummary';
import CocSummaryCard from './CocSummaryCard';

/** Same original card renderer without interactive callbacks or database access. */
export function cocSummaryHtml(summary: CocSummary, locale: 'es' | 'en' = 'en'): string {
  return renderToStaticMarkup(<CocSummaryCard summary={summary} locale={locale}/>);
}
