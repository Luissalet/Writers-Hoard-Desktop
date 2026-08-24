import { useState } from 'react';
import Modal from '@/components/common/Modal';
import ColorPicker from '@/components/common/ColorPicker';
import IconPicker from '@/components/common/IconPicker';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import type { Project } from '@/types';

interface EditProjectModalProps {
  project: Project;
  onClose: () => void;
  onSave: (changes: Partial<Project>) => Promise<void>;
}

export default function EditProjectModal({ project, onClose, onSave }: EditProjectModalProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(project.title);
  const [type, setType] = useState<Project['type']>(project.type);
  const [status, setStatus] = useState<Project['status']>(project.status);
  const [description, setDescription] = useState(project.description ?? '');
  const [color, setColor] = useState(project.color || '#c4973b');
  const [icon, setIcon] = useState(project.icon ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const nextTitle = title.trim();
    if (!nextTitle || saving) return;
    setSaving(true);
    try {
      await onSave({
        title: nextTitle,
        type,
        status,
        description: description.trim(),
        color,
        icon: icon || undefined,
      });
      onClose();
    } catch (error) {
      console.error('Project update failed', error);
      toast.error(t('project.edit.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t('project.edit.title')}>
      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm text-text-muted">{t('common.title')}</label>
          <input
            autoFocus
            value={title}
            onChange={event => setTitle(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void save(); }}
            className="w-full rounded-lg border border-border bg-elevated px-4 py-2.5 text-text-primary outline-none transition focus:border-accent-gold"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm text-text-muted">{t('createProject.type')}</label>
            <select
              value={type}
              onChange={event => setType(event.target.value as Project['type'])}
              className="w-full rounded-lg border border-border bg-elevated px-4 py-2.5 text-text-primary outline-none focus:border-accent-gold"
            >
              {(['saga', 'standalone', 'collection', 'idea'] as const).map(value => (
                <option key={value} value={value}>{t(`project.type.${value}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-text-muted">{t('project.edit.status')}</label>
            <select
              value={status}
              onChange={event => setStatus(event.target.value as Project['status'])}
              className="w-full rounded-lg border border-border bg-elevated px-4 py-2.5 text-text-primary outline-none focus:border-accent-gold"
            >
              {(['draft', 'in-progress', 'completed'] as const).map(value => (
                <option key={value} value={value}>{t(`project.status.${value}`)}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-text-muted">{t('common.description')}</label>
          <textarea
            value={description}
            onChange={event => setDescription(event.target.value)}
            rows={4}
            className="w-full resize-none rounded-lg border border-border bg-elevated px-4 py-2.5 text-text-primary outline-none transition focus:border-accent-gold"
          />
        </div>

        <div className="flex gap-6">
          <div className="flex-1">
            <label className="mb-1.5 block text-sm text-text-muted">{t('createProject.color')}</label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-text-muted">{t('createProject.icon')}</label>
            <IconPicker value={icon} onChange={setIcon} color={color} />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-border px-5 py-2.5 text-text-muted transition hover:bg-elevated disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!title.trim() || saving}
            className="rounded-lg bg-accent-gold px-5 py-2.5 font-semibold text-deep transition hover:bg-accent-amber disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
