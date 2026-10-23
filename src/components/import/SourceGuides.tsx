import { SOURCE_GUIDES } from './sourceGuideData';

/** Step-by-step export guides, one card per kind of tool, with what the importer keeps and drops. */
export default function SourceGuides({ es }: { es: boolean }) {
  const lang = es ? 'es' : 'en';
  return <details className="rounded-lg border border-border p-3" data-testid="world-folder-guides">
    <summary className="cursor-pointer text-sm text-accent-gold">{es ? 'Cómo exportar desde tu herramienta' : 'How to export from your tool'}</summary>
    <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2">
      {SOURCE_GUIDES.map(guide => <article key={guide.id} className="min-w-0 space-y-2 rounded border border-border p-3 text-xs text-text-muted" data-testid={`source-guide-${guide.id}`}>
        <h4 className="break-words text-sm font-semibold text-text-primary">{guide.title[lang]}</h4>
        <p>{guide.summary[lang]}</p>
        <ol className="list-decimal space-y-1 pl-4">{guide.steps[lang].map(step => <li key={step}>{step}</li>)}</ol>
        <p className="font-semibold text-text-primary">{es ? 'Qué se conserva' : 'What is kept'}</p>
        <ul className="list-disc space-y-1 pl-4" data-testid={`source-guide-${guide.id}-keeps`}>{guide.keeps[lang].map(item => <li key={item}>{item}</li>)}</ul>
        <p className="font-semibold text-text-primary">{es ? 'Qué se pierde' : 'What is dropped'}</p>
        <ul className="list-disc space-y-1 pl-4" data-testid={`source-guide-${guide.id}-drops`}>{guide.drops[lang].map(item => <li key={item}>{item}</li>)}</ul>
      </article>)}
    </div>
  </details>;
}
