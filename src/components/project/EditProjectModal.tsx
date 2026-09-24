import { useId, useState } from 'react';
import Modal from '@/components/common/Modal';
import ColorPicker from '@/components/common/ColorPicker';
import IconPicker from '@/components/common/IconPicker';
import { toast } from '@/components/common/toast';
import { getModeConfig } from '@/config/projectPresets';
import { useAppStore } from '@/stores/appStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { Project } from '@/types';

interface EditProjectModalProps {
  project: Project;
  onClose: () => void;
  onSave: (changes: Partial<Project>) => Promise<void>;
}

export default function EditProjectModal({ project, onClose, onSave }: EditProjectModalProps) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [title, setTitle] = useState(project.title);
  const [type, setType] = useState<Project['type']>(project.type);
  const [status, setStatus] = useState<Project['status']>(project.status);
  const [description, setDescription] = useState(project.description ?? '');
  const [color, setColor] = useState(project.color || '#c4973b');
  const [icon, setIcon] = useState(project.icon ?? '');
  const [saving, setSaving] = useState(false);
  // Escape or a stray backdrop click must not throw edits away; X and Cancel
  // still close deliberately.
  const dirty = title !== project.title
    || type !== project.type
    || status !== project.status
    || description !== (project.description ?? '')
    || color !== (project.color || '#c4973b')
    || icon !== (project.icon ?? '');
  const setShowEngineManager = useAppStore(s => s.setShowEngineManager);

  const modeConfig = getModeConfig(project.mode);
  const ModeIcon = modeConfig?.icon;

  const save = async (): Promise<boolean> => {
    const nextTitle = title.trim();
    if (!nextTitle || saving) return false;
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
      return true;
    } catch (error) {
      console.error('Project update failed', error);
      toast.error(t('project.edit.error'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * The preset itself is changed in the Engine Manager, because that is the
   * only place that can show what switching it would add and — the part worth
   * seeing before you agree to it — what it would switch off, by name.
   *
   * Edits in progress are saved on the way there rather than dropped: this is
   * a navigation out of a form, and silently discarding a retitled project to
   * go look at presets would be its own small betrayal.
   */
  const goToPresets = async () => {
    if (await save()) setShowEngineManager(true);
  };

  return (
    <Modal open onClose={onClose} busy={saving} dismissible={!dirty} title={t('project.edit.title')}>
      <div className="space-y-5">
        <div>
          <label htmlFor={`${fieldId}-title`} className="mb-1.5 block text-sm text-text-muted">{t('common.title')}</label>
          <input
            id={`${fieldId}-title`}
            autoFocus
            value={title}
            onChange={event => setTitle(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void save(); }}
            className="w-full rounded-lg border border-border bg-elevated px-4 py-2.5 text-text-primary outline-none transition focus:border-accent-gold"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${fieldId}-type`} className="mb-1.5 block text-sm text-text-muted">{t('createProject.type')}</label>
            <select
              id={`${fieldId}-type`}
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
            <label htmlFor={`${fieldId}-status`} className="mb-1.5 block text-sm text-text-muted">{t('project.edit.status')}</label>
            <select
              id={`${fieldId}-status`}
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
          <label htmlFor={`${fieldId}-description`} className="mb-1.5 block text-sm text-text-muted">{t('common.description')}</label>
          <textarea
            id={`${fieldId}-description`}
            value={description}
            onChange={event => setDescription(event.target.value)}
            rows={4}
            className="w-full resize-none rounded-lg border border-border bg-elevated px-4 py-2.5 text-text-primary outline-none transition focus:border-accent-gold"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-text-muted">{t('project.edit.preset')}</label>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-elevated px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              {ModeIcon && (
                <ModeIcon size={20} style={{ color: modeConfig?.color }} className="flex-shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-sm text-text-primary">{t(`modes.${project.mode}.name`)}</p>
                <p className="text-xs text-text-muted">{t(`modes.${project.mode}.description`)}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void goToPresets()}
              disabled={!title.trim() || saving}
              className="flex-shrink-0 rounded-lg border border-accent-gold/40 px-3 py-1.5 text-sm font-medium text-accent-gold transition hover:bg-accent-gold/10 disabled:opacity-50"
            >
              {t('engines.preset.change')}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-text-dim">{t('project.edit.presetHint')}</p>
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
