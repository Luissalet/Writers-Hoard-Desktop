// A thin download bar: a fraction when the size is known, a pulse when not.
export default function ProgressBar({ progress, indeterminate }: { progress: number; indeterminate?: boolean }) {
  return (
    <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
      {indeterminate ? (
        <div className="h-full w-full bg-accent-gold/60 animate-pulse" />
      ) : (
        <div className="h-full bg-accent-gold transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
      )}
    </div>
  );
}
