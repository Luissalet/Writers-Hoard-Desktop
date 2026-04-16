import { ChevronRight, X } from 'lucide-react';

export interface NewItemFormProps {
  /**
   * 'compact'  — inline flex row in a header bar (biography/maps/yarn-board style)
   * 'expanded' — card with padding, suitable for list sections (storyboard/timeline style)
   */
  variant: 'compact' | 'expanded';
  /** Controlled input value */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * Called when the user confirms (Enter key or confirm button).
   * Only called when value.trim() is non-empty.
   */
  onConfirm: () => void | Promise<void>;
  /** Called when the user cancels (Escape key or X button) */
  onCancel: () => void;
  /** Label for the confirm button. Defaults to "Create". */
  confirmLabel?: string;
}

export default function NewItemForm({
  variant,
  value,
  onChange,
  placeholder = 'Name...',
  onConfirm,
  onCancel,
  confirmLabel = 'Create',
}: NewItemFormProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      void onConfirm();
    }
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-1">
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="px-2.5 py-1 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold w-40"
          autoFocus
          onKeyDown={handleKeyDown}
        />
        <button
          onClick={() => value.trim() && void onConfirm()}
          className="p-1.5 text-accent-gold hover:text-accent-amber transition"
        >
          <ChevronRight size={16} />
        </button>
        <button onClick={onCancel} className="p-1.5 text-text-muted hover:text-text-primary transition">
          <X size={14} />
        </button>
      </div>
    );
  }

  // expanded variant
  return (
    <div className="mb-4 p-3 bg-elevated rounded-lg flex gap-2">
      <input
        autoFocus
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="flex-1 px-3 py-1 bg-surface border border-border rounded text-sm text-text-primary placeholder-text-muted focus:border-accent-gold focus:outline-none"
      />
      <button
        onClick={() => value.trim() && void onConfirm()}
        className="px-3 py-1 bg-accent-gold text-deep rounded font-semibold text-sm hover:bg-accent-amber transition"
      >
        {confirmLabel}
      </button>
      <button onClick={onCancel} className="px-2 py-1 text-text-muted hover:text-text-primary transition">
        <X size={16} />
      </button>
    </div>
  );
}
