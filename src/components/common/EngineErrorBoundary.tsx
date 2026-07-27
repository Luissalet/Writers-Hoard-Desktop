import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface EngineErrorBoundaryProps {
  children: ReactNode;
  resetKey: string;
  title: string;
  message: string;
  retryLabel: string;
  detailsLabel: string;
}

interface EngineErrorBoundaryState {
  error: Error | null;
}

/** Keep a single optional engine failure from taking down the project shell. */
export default class EngineErrorBoundary extends Component<
  EngineErrorBoundaryProps,
  EngineErrorBoundaryState
> {
  state: EngineErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): EngineErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Engine render failed', error, info);
  }

  componentDidUpdate(previous: EngineErrorBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-[22rem] items-center justify-center">
        <div className="max-w-lg rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 text-red-400" size={28} />
          <h2 className="font-serif text-lg font-semibold text-text-primary">
            {this.props.title}
          </h2>
          <p className="mt-2 text-sm text-text-muted">{this.props.message}</p>
          <details className="mt-4 text-left text-xs text-text-dim">
            <summary className="cursor-pointer select-none">{this.props.detailsLabel}</summary>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-3">
              {this.state.error.message}
            </pre>
          </details>
          <button
            type="button"
            onClick={this.retry}
            className="mx-auto mt-5 flex items-center gap-2 rounded-lg bg-accent-gold px-4 py-2 text-sm font-medium text-background transition hover:brightness-110"
          >
            <RotateCcw size={15} />
            {this.props.retryLabel}
          </button>
        </div>
      </div>
    );
  }
}
