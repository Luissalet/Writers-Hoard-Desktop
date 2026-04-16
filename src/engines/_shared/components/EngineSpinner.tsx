export interface EngineSpinnerProps {
  /** Override for the outer container class. Defaults to "flex items-center justify-center h-64". */
  className?: string;
}

export default function EngineSpinner({ className = 'flex items-center justify-center h-64' }: EngineSpinnerProps) {
  return (
    <div className={className}>
      <div className="w-8 h-8 border-2 border-accent-gold border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
