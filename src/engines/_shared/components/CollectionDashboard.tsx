import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import NewItemForm from './NewItemForm';
import { useTranslation } from '@/i18n/useTranslation';

export interface CollectionDashboardProps<T extends { id: string; title: string; createdAt: number }> {
  /** Lucide icon component for the header and cards */
  icon: LucideIcon;
  /** Section title, e.g. "Your Maps", "Your Timelines" */
  title: string;
  /** Noun for the item type, e.g. "Map", "Timeline", "Board" */
  itemNoun: string;
  /** The list of items to display */
  items: T[];
  /** Currently active/selected item ID */
  activeId: string;
  /** Called when user selects an item */
  onSelect: (id: string) => void;
  /** Called when user creates a new item. Receives the trimmed name string. */
  onCreate: (name: string) => Promise<void>;
  /** Called when user deletes an item */
  onDelete: (id: string) => Promise<void>;
  /** Placeholder for the new item input */
  placeholder?: string;
}

export default function CollectionDashboard<T extends { id: string; title: string; createdAt: number }>({
  icon: Icon,
  title,
  itemNoun,
  items,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  placeholder,
}: CollectionDashboardProps<T>) {
  const { t } = useTranslation();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');

  const effectivePlaceholder = placeholder ?? t('shared.dashboard.namePlaceholder');

  const handleCreate = async () => {
    if (newName.trim()) {
      await onCreate(newName.trim());
      setNewName('');
      setShowNew(false);
    }
  };

  const handleDelete = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;

    const message = t('shared.dashboard.deleteConfirm')
      .replace('{item}', itemNoun)
      .replace('{name}', item.title);
    if (confirm(message)) {
      await onDelete(id);
    }
  };

  return (
    <div className="border border-border rounded-xl bg-surface/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Icon size={14} className="text-accent-gold" />
          {title}
        </h3>
        {showNew ? (
          <NewItemForm
            variant="compact"
            value={newName}
            onChange={setNewName}
            placeholder={effectivePlaceholder}
            onConfirm={handleCreate}
            onCancel={() => {
              setShowNew(false);
              setNewName('');
            }}
          />
        ) : (
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
          >
            <Plus size={13} />
            {t('shared.dashboard.newItem').replace('{item}', itemNoun)}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-text-dim text-center py-4">
          {t('shared.dashboard.empty').replace('{item}', itemNoun.toLowerCase())}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {items.map(item => {
            const isActive = item.id === activeId;
            return (
              <div
                key={item.id}
                className={`group relative rounded-lg border-2 transition cursor-pointer ${
                  isActive ? 'border-accent-gold bg-accent-gold/10' : 'border-border bg-elevated hover:border-accent-gold/40'
                }`}
              >
                <button onClick={() => onSelect(item.id)} className="w-full text-left p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon size={12} className={isActive ? 'text-accent-gold' : 'text-text-dim'} />
                    <span
                      className={`text-sm font-serif font-semibold truncate ${
                        isActive ? 'text-accent-gold' : 'text-text-primary'
                      }`}
                    >
                      {item.title}
                    </span>
                  </div>
                  <p className="text-[10px] text-text-dim">{new Date(item.createdAt).toLocaleDateString()}</p>
                </button>
                {items.length > 1 && (
                  <button
                    onClick={async e => {
                      e.stopPropagation();
                      await handleDelete(item.id);
                    }}
                    className="absolute top-1.5 right-1.5 p-1 rounded-full opacity-0 group-hover:opacity-100 text-text-dim hover:text-danger hover:bg-danger/10 transition"
                    title={t('shared.dashboard.deleteItem').replace('{item}', itemNoun)}
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
