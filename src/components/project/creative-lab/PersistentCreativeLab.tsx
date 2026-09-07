import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { useDebouncedField } from '@/engines/_shared/useDebouncedField';
import { saveCreativePossibilities } from '@/services/creativePossibilities';
import { useTranslation } from '@/i18n/useTranslation';
import { CreativeLab, type CreativeLabProps } from './CreativeLab';
import type { CreativePossibility } from './types';

type PersistentProps = Omit<CreativeLabProps, 'initialPossibilities' | 'possibilities' | 'onPossibilitiesChange'>;

function LoadedCreativeLab(props: PersistentProps & { remote: string }) {
  const { t } = useTranslation();
  const draft = useDebouncedField(props.remote, value =>
    saveCreativePossibilities(props.projectId, JSON.parse(value) as CreativePossibility[]),
  );
  const latest = useRef(draft.value);
  useEffect(() => { latest.current = draft.value; }, [draft.value]);

  return (
    <div onBlur={draft.onBlur}>
      {draft.error && (
        <div role="alert" className="mb-3 flex items-center gap-3 text-sm text-red-400">
          <span>{t('creativeLab.actionError')}</span>
          <button type="button" onClick={() => void draft.retry()} className="underline">{t('projectCockpit.retry')}</button>
        </div>
      )}
      <CreativeLab
        {...props}
        possibilities={JSON.parse(draft.value) as CreativePossibility[]}
        onPossibilitiesChange={update => {
          const next = update(JSON.parse(latest.current) as CreativePossibility[]);
          latest.current = JSON.stringify(next);
          draft.onChange(latest.current);
        }}
      />
    </div>
  );
}

/** A project key prevents a queued draft from following navigation into another project. */
export default function PersistentCreativeLab(props: PersistentProps) {
  const { t } = useTranslation();
  const project = useLiveQuery(() => db.projects.get(props.projectId), [props.projectId]);
  if (!project) return <p role="status" className="p-5 text-sm text-text-muted">{t('common.loading')}</p>;
  return <LoadedCreativeLab key={props.projectId} {...props} remote={JSON.stringify(project.creativePossibilities ?? [])} />;
}
