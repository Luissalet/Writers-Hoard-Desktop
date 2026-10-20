import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { PanelProps } from './StatsPanel';
import { damageMarks } from './mechanics';
import { sheetCopy } from './copy';
import { button, input } from './uiStyles';
import { Field, NumberField } from './ui';
export default function ResourcePanel({ sheet, locale, update, confirm }: PanelProps) {
  const c = sheetCopy[locale], dh = sheet.preset.startsWith('daggerheart');
  const [damage, setDamage] = useState(0), [armor, setArmor] = useState(false), [massive, setMassive] = useState(false);
  const change = (id: string, amount: number) => update(current => ({ ...current, resources: current.resources.map(item => item.id === id ? { ...item, current: Math.max(0, Math.min(item.max, item.current + amount)) } : item) }));
  let marks: number | null = null;
  try { marks = damageMarks(damage, sheet.numbers.major ?? 6, sheet.numbers.severe ?? 12, armor, massive); } catch { /* Invalid thresholds stay editable and cannot apply. */ }
  return <div className="space-y-5"><p className="max-w-prose text-sm text-text-muted">{c.manual}</p>
    <div className="grid gap-3 lg:grid-cols-2">{sheet.resources.map(resource => <article key={resource.id} className="space-y-3 rounded-lg border border-border p-4">
      <Field label={c.label}><input className={input} aria-label={`${c.label} · ${resource.label}`} value={resource.label} onChange={event => update(current => ({ ...current, resources: current.resources.map(item => item.id === resource.id ? { ...item, label: event.target.value } : item) }))} /></Field>
      <div className="grid grid-cols-2 gap-3"><NumberField label={`${c.current} · ${resource.label}`} value={resource.current} min={0} max={resource.max} onChange={value => update(current => ({ ...current, resources: current.resources.map(item => item.id === resource.id ? { ...item, current: Math.max(0, Math.min(item.max, value)) } : item) }))} /><NumberField label={`${c.max} · ${resource.label}`} value={resource.max} min={0} onChange={value => update(current => ({ ...current, resources: current.resources.map(item => item.id === resource.id ? { ...item, max: Math.max(0, value), current: Math.min(item.current, Math.max(0, value)) } : item) }))} /></div>
      <div className="flex flex-wrap items-center gap-2"><button className={button} aria-label={`−1 ${resource.label}`} onClick={() => change(resource.id, -1)}>−1</button><button className={button} aria-label={`+1 ${resource.label}`} onClick={() => change(resource.id, 1)}>+1</button><label className="flex items-center gap-2 text-sm text-text-muted"><input type="checkbox" checked={resource.marked} onChange={event => update(current => ({ ...current, resources: current.resources.map(item => item.id === resource.id ? { ...item, marked: event.target.checked } : item) }))} />{c.marked}</label><button className={`${button} ml-auto`} aria-label={`${c.remove} · ${resource.label}`} onClick={() => confirm(`${c.remove}: ${resource.label}?`, () => update(current => ({ ...current, resources: current.resources.filter(item => item.id !== resource.id) })))}><Trash2 size={14} /></button></div>
      <progress className="h-2 w-full accent-accent-gold" aria-label={resource.label} max={resource.max || 1} value={resource.current} /><p className="text-right font-mono text-sm text-text-primary">{resource.current} / {resource.max}</p>
    </article>)}</div>
    <button className={button} disabled={sheet.resources.length >= 500} onClick={() => update(current => ({ ...current, resources: [...current.resources, { id: crypto.randomUUID(), label: c.addResource, current: 0, max: 10, marked: false }] }))}><Plus size={16} />{c.addResource}</button>
    {dh && <div className="space-y-4 rounded-lg border border-border p-4"><p className="text-sm text-text-muted">{c.damageHelp}</p><div className="grid gap-3 sm:grid-cols-3"><NumberField label={c.damage} value={damage} min={0} onChange={value => setDamage(Math.max(0, value))} /><NumberField label={c.major} value={sheet.numbers.major ?? 6} min={1} onChange={value => update(current => ({ ...current, numbers: { ...current.numbers, major: value } }))} /><NumberField label={c.severe} value={sheet.numbers.severe ?? 12} min={1} onChange={value => update(current => ({ ...current, numbers: { ...current.numbers, severe: value } }))} /></div><label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={armor} onChange={event => setArmor(event.target.checked)} />{c.armor}</label><label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={massive} onChange={event => setMassive(event.target.checked)} />{c.massive}</label><button className={button} disabled={marks === null || !sheet.resources.some(item => item.id === 'hp') || (armor && !sheet.resources.some(item => item.id === 'armor' && item.current < item.max))} onClick={() => {
      if (marks === null) return; const count = marks;
      update(current => ({ ...current, resources: current.resources.map(item => item.id === 'hp' ? { ...item, current: Math.min(item.max, item.current + count) } : armor && damage > 0 && item.id === 'armor' ? { ...item, current: Math.min(item.max, item.current + 1) } : item) }));
    }}>{c.applyDamage} · {marks ?? '—'}</button></div>}
  </div>;
}
