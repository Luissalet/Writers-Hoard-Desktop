import { useState, type ReactNode } from 'react';
import { input } from './uiStyles';
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block min-w-0 space-y-1 text-sm text-text-muted">{label}{children}</label>; }
export function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  const [editing,setEditing]=useState<{text:string;value:number}|null>(null);
  const text=editing&&editing.value===value?editing.text:String(value);
  return <Field label={label}><input className={input} aria-label={label} type="number" step="any" min={min} max={max} value={text} onBlur={()=>setEditing(null)} onChange={event => { const next = event.target.valueAsNumber; setEditing({text:event.target.value,value:Number.isFinite(next)?next:value}); if (Number.isFinite(next)) onChange(next); }} /></Field>;
}
