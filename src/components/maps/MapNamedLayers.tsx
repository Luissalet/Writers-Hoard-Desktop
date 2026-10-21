import {useEmbeddedToolCloseGuard} from '@/components/editor/toolBlocks/EmbeddedToolCloseContext';
import {useLocalToolAtomPending} from '@/engines/local/blocks/pending';
import { useState, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { generateId } from '@/utils/idGenerator';
import { ConfirmDialog } from '@/engines/_shared';
import type { MapNamedLayer } from '@/types';
import type { MapFeatureEditor } from './useMapFeatures';

export default function MapNamedLayers({ editor }: { editor: MapFeatureEditor }) {
  const [name, setName] = useState('');
  const deleteBaseline=useRef<MapNamedLayer[]>([]);
  const renameBaselines=useRef(new Map<string,MapNamedLayer[]>());
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<MapNamedLayer | null>(null);
  const { copy } = editor;
  const pending=!!name.trim()||Object.entries(renames).some(([id,value])=>value!==(editor.namedLayers.find(layer=>layer.id===id)?.name??''));
  useEmbeddedToolCloseGuard(()=>!pending&&!editor.busy);useLocalToolAtomPending(pending||editor.busy);
  const add = async () => {
    if (!name.trim()) return;
    const id = generateId('map-layer');
    if (await editor.changeNamedLayers([...editor.namedLayers, { id, name: name.trim(), visible: true }])) {
      setName(''); editor.setActiveLayerId(id);
    }
  };
  return <details className="rounded-lg border border-border px-3 py-2 text-xs text-text-muted" data-testid="map-named-layers"><summary className="cursor-pointer">{copy.groups} ({editor.namedLayers.length})</summary>
    <div className="space-y-2 pt-3">
      {editor.namedLayers.map(layer => <div key={layer.id} className="flex items-center flex-wrap gap-2">
        <input type="checkbox" checked={layer.visible} aria-label={`${copy.show}: ${layer.name}`} disabled={editor.busy} onChange={() => void editor.changeNamedLayers(editor.namedLayers.map(item => item.id === layer.id ? { ...item, visible: !item.visible } : item))} data-testid={`map-named-layer-${layer.id}`} />
        <input className="min-w-0 max-w-xs flex-1 rounded border border-border bg-elevated px-2 py-1 text-text-primary" aria-label={`${copy.renameLayer}: ${layer.name}`} value={renames[layer.id] ?? layer.name} onChange={event => {if(!renameBaselines.current.has(layer.id))renameBaselines.current.set(layer.id,structuredClone(editor.namedLayers));setRenames(previous => ({ ...previous, [layer.id]: event.target.value }));}} disabled={editor.busy} />
        {renames[layer.id] !== undefined && renames[layer.id] !== layer.name && <button type="button" disabled={editor.busy || !renames[layer.id].trim()} onClick={async () => { if (await editor.changeNamedLayers((renameBaselines.current.get(layer.id)??editor.namedLayers).map(item => item.id === layer.id ? { ...item, name: renames[layer.id].trim() } : item),renameBaselines.current.get(layer.id))) {renameBaselines.current.delete(layer.id); setRenames(previous => { const next = { ...previous }; delete next[layer.id]; return next; });} }} className="px-2 py-1 text-accent-gold">{copy.save}</button>}
        <button type="button" aria-label={`${copy.deleteLayer}: ${layer.name}`} title={copy.deleteLayer} disabled={editor.busy} onClick={() => {deleteBaseline.current=structuredClone(editor.namedLayers);setDeleting(layer);}} className="rounded p-1.5 text-danger hover:bg-danger/10"><Trash2 size={14} /></button>
      </div>)}
      <form className="flex items-center flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void add(); }}><input value={name} onChange={event => setName(event.target.value)} placeholder={copy.newLayer} aria-label={copy.newLayer} disabled={editor.busy} className="min-w-0 max-w-xs flex-1 rounded border border-border bg-elevated px-2 py-1 text-text-primary" data-testid="map-new-layer-name" /><button type="submit" disabled={editor.busy || !name.trim()} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-accent-gold disabled:opacity-50" data-testid="map-new-layer-create"><Plus size={13} />{copy.addLayer}</button></form>
      {!!editor.namedLayers.length && <label className="flex items-center flex-wrap gap-2">{copy.drawingLayer}<select value={editor.activeLayerId} onChange={event => editor.setActiveLayerId(event.target.value)} disabled={editor.busy} className="rounded border border-border bg-elevated px-2 py-1 text-text-primary" data-testid="map-active-layer"><option value="">{copy.ungrouped}</option>{editor.namedLayers.map(layer => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>}
    </div>
    <ConfirmDialog open={!!deleting} destructive title={copy.deleteLayer} message={`${deleting?.name ?? ''}. ${copy.deleteLayerHelp}`} onCancel={() => setDeleting(null)} onConfirm={async () => { if (await editor.changeNamedLayers(deleteBaseline.current.filter(layer => layer.id !== deleting?.id),deleteBaseline.current)) { if (editor.activeLayerId === deleting?.id) editor.setActiveLayerId(''); setDeleting(null); } }} />
  </details>;
}
