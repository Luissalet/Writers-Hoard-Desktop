import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { PanelProps } from './StatsPanel';
import type { SheetRow } from './types';
import { Field, NumberField } from './ui';
import { button, input } from './uiStyles';
import {
  daggerheartAdversaryTypes, daggerheartFeatureKinds, daggerheartFeatureLabel, daggerheartTierLevels, daggerheartTiers,
  type DaggerheartAdversaryRow,
} from './daggerheartAdversary';

export function DaggerheartAdversaryStats({ sheet, locale, update }: PanelProps) {
  const es = locale === 'es';
  const tier = sheet.numbers.tier;
  const levels = daggerheartTierLevels(tier);
  const currentType = sheet.details.adversaryType ?? '';
  const levelsId = useId();
  const changeNumber = (key: string, value: number) => update(current => ({
    ...current, numbers: { ...current.numbers, [key]: value },
  }));
  const changeDetail = (key: string, value: string) => update(current => ({
    ...current, details: { ...current.details, [key]: value },
  }));
  const textFields = [
    ['description', es ? 'Descripción' : 'Description'],
    ['motives', es ? 'Motivos y tácticas' : 'Motives & tactics'],
    ['weapon', es ? 'Ataque estándar' : 'Standard attack'],
    ['range', es ? 'Alcance' : 'Range'],
    ['damage', es ? 'Daño' : 'Damage'],
  ];
  const numberFields = [
    ['difficulty', es ? 'Dificultad' : 'Difficulty'],
    ['major', es ? 'Umbral grave' : 'Major threshold'],
    ['severe', es ? 'Umbral severo' : 'Severe threshold'],
    ['attack', es ? 'Bonificador de ataque' : 'Attack modifier'],
  ];

  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={es ? 'Rango de poder' : 'Tier'}>
        <select className={input} value={tier ?? ''} aria-label={es ? 'Rango de poder' : 'Tier'} aria-describedby={levels ? levelsId : undefined}
          onChange={event => changeNumber('tier', Number(event.target.value))}>
          {!levels && <option value={tier ?? ''} disabled>{tier ?? (es ? 'Sin indicar' : 'Unspecified')}</option>}
          {daggerheartTiers.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        {levels && <span id={levelsId} className="block text-xs">{es ? 'Nivel del grupo' : 'Party level'} {levels}</span>}
      </Field>
      <Field label={es ? 'Tipo de adversario' : 'Adversary type'}>
        <select className={input} value={currentType} onChange={event => changeDetail('adversaryType', event.target.value)}>
          <option value="">{es ? 'Sin indicar' : 'Unspecified'}</option>
          {currentType && !Object.hasOwn(daggerheartAdversaryTypes, currentType) && <option value={currentType}>{currentType}</option>}
          {Object.entries(daggerheartAdversaryTypes).map(([type, spanish]) =>
            <option key={type} value={type}>{es ? spanish : type}</option>)}
        </select>
      </Field>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {numberFields.map(([key, label]) => <NumberField key={key} label={label} value={sheet.numbers[key] ?? 0}
        onChange={value => changeNumber(key, value)} />)}
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {textFields.map(([key, label], index) => <div key={key} className={index < 2 ? 'xl:col-span-3' : 'xl:col-span-2'}>
        <Field label={label}>
          {index < 2 ? <textarea className={input} rows={2} value={sheet.details[key] ?? ''}
            onChange={event => changeDetail(key, event.target.value)} /> :
            <input className={input} value={sheet.details[key] ?? ''} onChange={event => changeDetail(key, event.target.value)} />}
        </Field>
      </div>)}
    </div>
  </div>;
}

export function DaggerheartAdversaryRows({ sheet, locale, update, confirm }: PanelProps) {
  const es = locale === 'es';
  const change = (id: string, values: Partial<SheetRow>) => update(current => ({
    ...current, rows: current.rows.map(row => row.id === id ? { ...row, ...values } : row),
  }));
  const add = (section: string, metadata: DaggerheartAdversaryRow) => update(current => current.rows.length >= 500 ? current : ({
    ...current, rows: [...current.rows, { id: crypto.randomUUID(), section, name: '', detail: '', quantity: 1,
      expression: '', daggerheartAdversary: metadata }],
  }));
  const remove = (row: SheetRow, label: string) => confirm(label, () => update(current => ({
    ...current, rows: current.rows.filter(item => item.id !== row.id),
  })));
  const groups = [
    { label: es ? 'Experiencias' : 'Experiences', add: es ? 'Añadir experiencia' : 'Add experience',
      item: es ? 'Experiencia' : 'Experience', metadata: { kind: 'experience', modifier: 0 } as const },
    { label: es ? 'Rasgos' : 'Features', add: es ? 'Añadir rasgo' : 'Add feature',
      item: es ? 'Rasgo' : 'Feature', metadata: { kind: 'feature', category: 'passive' } as const },
  ];

  return groups.map(group => <section key={group.metadata.kind} className="space-y-3 border-t border-border pt-4">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold text-text-primary">{group.label}</h3>
      <button type="button" className={button} disabled={sheet.rows.length >= 500} onClick={() => add(group.label, group.metadata)}>
        <Plus size={16} aria-hidden="true" />{group.add}
      </button>
    </header>
    {sheet.rows.filter(row => row.daggerheartAdversary?.kind === group.metadata.kind).map((row, index) => {
      const metadata = row.daggerheartAdversary!;
      const name = group.item + ' ' + (index + 1);
      const removeLabel = (es ? 'Quitar ' : 'Remove ') + (row.name || name);
      return <div key={row.id} className="space-y-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
          <Field label={name}>
            <input className={input} value={row.name} onChange={event => change(row.id, { name: event.target.value })} />
          </Field>
          <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
            {metadata.kind === 'experience' ? <NumberField label={(es ? 'Modificador de ' : 'Modifier for ') + name}
              value={metadata.modifier} onChange={modifier => {
                if (Number.isSafeInteger(modifier)) change(row.id, { daggerheartAdversary: { kind: 'experience', modifier } });
              }} /> : <Field label={(es ? 'Tipo de ' : 'Kind of ') + name}>
              <select className={input} value={metadata.category} onChange={event => {
                const category = daggerheartFeatureKinds.find(kind => kind === event.target.value);
                if (category) change(row.id, { daggerheartAdversary: { kind: 'feature', category } });
              }}>
                {daggerheartFeatureKinds.map(kind => <option key={kind} value={kind}>{daggerheartFeatureLabel(kind, locale)}</option>)}
              </select>
            </Field>}
          </div>
          <button type="button" className={button} aria-label={removeLabel} title={removeLabel}
            onClick={() => remove(row, removeLabel)}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
        {metadata.kind === 'feature' && <Field label={(es ? 'Texto de ' : 'Text of ') + name}>
          <textarea className={input} rows={3} value={row.detail}
            onChange={event => change(row.id, { detail: event.target.value })} />
        </Field>}
      </div>;
    })}
  </section>);
}
