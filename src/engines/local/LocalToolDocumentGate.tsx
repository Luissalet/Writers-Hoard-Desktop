import { Suspense, type ComponentType, type ReactNode } from 'react';

export interface LocalToolDocumentGateProps {
  status: 'loading' | 'ready' | 'error';
  skeleton?: ComponentType;
  locale?: 'en' | 'es';
  error?: string;
  onRetry?: () => void;
  retrying?: boolean;
  children?: ReactNode;
}

/** Initial document load. A tool can keep a ready view mounted during later reads. */
export function LocalToolDocumentGate({
  status, skeleton: Skeleton, locale = 'en', error, onRetry, retrying, children,
}: LocalToolDocumentGateProps) {
  const es = locale === 'es';
  const loadingLabel = es ? 'Cargando…' : 'Loading...';

  if (status === 'ready') return <>{children}</>;
  if (status === 'loading') {
    const standard = <p className="text-sm text-text-muted">{loadingLabel}</p>;
    return <div role="status" aria-label={loadingLabel}>
      {Skeleton ? <Suspense fallback={standard}><Skeleton /></Suspense> : standard}
    </div>;
  }

  return <div className="space-y-2 text-sm">
    <p role="alert" className="break-words text-danger">{error || (es ? 'No se pudo abrir el documento.' : 'The document could not be opened.')}</p>
    {onRetry && <button
      type="button"
      onClick={onRetry}
      disabled={retrying}
      className="min-h-10 rounded-lg border border-border px-3 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50"
    >
      {es ? 'Reintentar' : 'Retry'}
    </button>}
  </div>;
}
