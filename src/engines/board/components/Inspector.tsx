import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight, ArrowRight, ArrowLeftFromLine, ChevronDown, ChevronUp,
  Image as ImageIcon, Lock, Minus, Pin, Plus, Trash2, X,
} from 'lucide-react';
import { InlineColorPicker } from '@/components/common/ColorPicker';
import ImagePreviewCrop from '@/components/common/ImagePreviewCrop';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { useTranslation } from '@/i18n/useTranslation';
import { EDGE_KINDS, NODE_ROLES, POSTIT_PALETTE, edgeKindColor } from '../catalog';
import type { BoardEdge, BoardLayer, BoardNode, BoardShape } from '../types';

const SHAPES: BoardShape[] = ['rectangle', 'circle', 'diamond', 'pill', 'hexagon'];
const LINE_STYLES: BoardEdge['style'][] = ['solid', 'dashed', 'dotted'];
const CURVATURES: BoardEdge['curvature'][] = ['curved', 'straight', 'step', 'arc'];
const DIRECTIONS: BoardEdge['direction'][] = ['none', 'forward', 'backward', 'both'];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-dim">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent-gold';

function Choice<T extends string>({
  options,
  value,
  onChange,
  labelFor,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labelFor?: (value: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`rounded-lg border px-2 py-1 text-xs capitalize transition ${
            value === option
              ? 'border-accent-gold bg-accent-gold/15 text-accent-gold'
              : 'border-border text-text-muted hover:text-text-primary'
          }`}
        >
          {labelFor ? labelFor(option) : option}
        </button>
      ))}
    </div>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-elevated px-2 py-1.5">
      {tags.map((tag) => (
        <span key={tag} className="flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 text-[11px] text-text-muted">
          {tag}
          <button type="button" onClick={() => onChange(tags.filter((item) => item !== tag))}>
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && draft.trim()) {
            event.preventDefault();
            const next = draft.trim();
            if (!tags.includes(next)) onChange([...tags, next]);
            setDraft('');
          }
          if (event.key === 'Backspace' && !draft && tags.length > 0) onChange(tags.slice(0, -1));
        }}
        className="min-w-[70px] flex-1 bg-transparent text-xs text-text-primary outline-none"
        placeholder="+ tag"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface NodeInspectorProps {
  node: BoardNode;
  layers: BoardLayer[];
  onPatch: (changes: Partial<BoardNode>) => void;
  onDelete: () => void;
  onBindEntity: () => void;
  onRaise: (delta: number) => void;
}

export function NodeInspector({ node, layers, onPatch, onDelete, onBindEntity, onRaise }: NodeInspectorProps) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [propKey, setPropKey] = useState('');
  const [propValue, setPropValue] = useState('');

  const readFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => setPendingImage(String(reader.result));
    reader.readAsDataURL(file);
  }, []);

  const props = useMemo(() => Object.entries(node.props ?? {}), [node.props]);
  const usesRichText = node.kind === 'text' || node.kind === 'card';

  return (
    <div className="space-y-3.5">
      <Field label={t('board.inspector.title')}>
        <input
          value={node.title}
          onChange={(event) => onPatch({ title: event.target.value })}
          className={inputClass}
        />
      </Field>

      {node.kind === 'card' ? (
        <Field label={t('board.inspector.role')}>
          <div className="flex flex-wrap gap-1">
            {NODE_ROLES.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => onPatch({ role: node.role === role.id ? undefined : role.id, color: role.color })}
                className={`rounded-lg border px-2 py-1 text-xs transition ${
                  node.role === role.id
                    ? 'border-accent-gold bg-accent-gold/15 text-accent-gold'
                    : 'border-border text-text-muted hover:text-text-primary'
                }`}
              >
                {t(role.labelKey)}
              </button>
            ))}
          </div>
        </Field>
      ) : null}

      {node.kind === 'shape' ? (
        <Field label={t('board.inspector.shape')}>
          <Choice options={SHAPES} value={node.shape ?? 'rectangle'} onChange={(shape) => onPatch({ shape })} />
        </Field>
      ) : null}

      {usesRichText ? (
        <Field label={t('board.inspector.body')}>
          <div className="rounded-lg border border-border bg-elevated">
            <TiptapEditor
              content={node.richContent ?? (node.content ? `<p>${node.content}</p>` : '')}
              onChange={(html) => onPatch({ richContent: html, content: htmlToPlain(html) })}
              placeholder={t('board.inspector.bodyPlaceholder')}
            />
          </div>
        </Field>
      ) : node.kind !== 'entity' && node.kind !== 'image' ? (
        <Field label={t('board.inspector.body')}>
          <textarea
            value={node.content}
            onChange={(event) => onPatch({ content: event.target.value })}
            rows={4}
            className={`${inputClass} resize-y`}
          />
        </Field>
      ) : null}

      <Field label={t('board.inspector.color')}>
        <div className="flex items-center gap-2">
          <InlineColorPicker value={node.color} onChange={(color) => onPatch({ color })} size="sm" />
          {node.kind === 'postit' ? (
            <div className="flex flex-wrap gap-1">
              {POSTIT_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => onPatch({ color })}
                  style={{ background: color }}
                  className="h-5 w-5 rounded border border-black/20"
                />
              ))}
            </div>
          ) : null}
        </div>
      </Field>

      {node.kind === 'image' || node.kind === 'card' ? (
        <Field label={t('board.inspector.image')}>
          <div className="flex items-center gap-2">
            {node.image ? (
              <button type="button" onClick={() => setPendingImage(node.imageOriginal ?? node.image ?? null)}>
                <img src={node.image} alt="" className="h-14 w-14 rounded-lg object-cover" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-muted transition hover:text-accent-gold"
            >
              <ImageIcon size={13} /> {t('board.inspector.upload')}
            </button>
            {node.image ? (
              <button
                type="button"
                onClick={() => onPatch({ image: undefined, imageOriginal: undefined })}
                className="rounded-lg border border-border p-1.5 text-text-muted transition hover:text-danger"
                title={t('board.inspector.removeImage')}
              >
                <Trash2 size={13} />
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) readFile(file);
                event.target.value = '';
              }}
            />
          </div>
        </Field>
      ) : null}

      <Field label={t('board.inspector.tags')}>
        <TagEditor tags={node.tags ?? []} onChange={(tags) => onPatch({ tags })} />
      </Field>

      <Field label={t('board.inspector.layer')}>
        <select
          value={node.layerId ?? ''}
          onChange={(event) => onPatch({ layerId: event.target.value || undefined })}
          className={inputClass}
        >
          <option value="">{t('board.layers.none')}</option>
          {layers.map((layer) => (
            <option key={layer.id} value={layer.id}>
              {layer.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('board.inspector.reference')}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBindEntity}
            className="flex-1 rounded-lg border border-border px-2.5 py-1.5 text-left text-xs text-text-muted transition hover:text-accent-gold"
          >
            {node.ref ? `${node.ref.entityType} · ${node.ref.title}` : t('board.inspector.bind')}
          </button>
          {node.ref ? (
            <button
              type="button"
              onClick={() => onPatch({ ref: undefined })}
              className="rounded-lg border border-border p-1.5 text-text-muted transition hover:text-danger"
              title={t('common.remove')}
              aria-label={t('common.remove')}
            >
              <X size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </Field>

      <Field label={t('board.inspector.props')}>
        <div className="space-y-1">
          {props.map(([key, value]) => (
            <div key={key} className="flex items-center gap-1 text-xs">
              <span className="w-24 truncate text-text-muted">{key}</span>
              <span className="flex-1 truncate text-text-primary">{String(value)}</span>
              <button
                type="button"
                onClick={() => {
                  const next = { ...(node.props ?? {}) };
                  delete next[key];
                  onPatch({ props: next });
                }}
                className="text-text-dim hover:text-danger"
                title={t('common.remove')}
                aria-label={t('common.remove')}
              >
                <X size={11} aria-hidden="true" />
              </button>
            </div>
          ))}
          <div className="flex gap-1">
            <input
              value={propKey}
              onChange={(event) => setPropKey(event.target.value)}
              placeholder="key"
              className={`${inputClass} w-24 px-2 py-1 text-xs`}
            />
            <input
              value={propValue}
              onChange={(event) => setPropValue(event.target.value)}
              placeholder="value"
              className={`${inputClass} flex-1 px-2 py-1 text-xs`}
            />
            <button
              type="button"
              onClick={() => {
                if (!propKey.trim()) return;
                const numeric = Number(propValue);
                onPatch({
                  props: {
                    ...(node.props ?? {}),
                    [propKey.trim()]: propValue !== '' && !Number.isNaN(numeric) ? numeric : propValue,
                  },
                });
                setPropKey('');
                setPropValue('');
              }}
              className="rounded-lg border border-border px-2 text-text-muted transition hover:text-accent-gold"
              title={t('common.add')}
              aria-label={t('common.add')}
            >
              <Plus size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      </Field>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => onPatch({ locked: !node.locked })}
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition ${
            node.locked ? 'border-accent-gold text-accent-gold' : 'border-border text-text-muted'
          }`}
        >
          <Lock size={12} /> {t('board.inspector.lock')}
        </button>
        <button
          type="button"
          onClick={() => onPatch({ pinned: !node.pinned })}
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition ${
            node.pinned ? 'border-accent-plum-light text-accent-plum-light' : 'border-border text-text-muted'
          }`}
          title={t('board.inspector.pinHint')}
        >
          <Pin size={12} /> {t('board.inspector.pin')}
        </button>
        {node.kind === 'frame' ? (
          <button
            type="button"
            onClick={() => onPatch({ collapsed: !node.collapsed })}
            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-muted"
          >
            {node.collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />} {t('board.inspector.collapse')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onRaise(1)}
          className="rounded-lg border border-border px-2 py-1 text-xs text-text-muted"
          title={t('board.inspector.bringForward')}
        >
          <ChevronUp size={12} />
        </button>
        <button
          type="button"
          onClick={() => onRaise(-1)}
          className="rounded-lg border border-border px-2 py-1 text-xs text-text-muted"
          title={t('board.inspector.sendBackward')}
        >
          <ChevronDown size={12} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto flex items-center gap-1 rounded-lg border border-danger/40 px-2 py-1 text-xs text-danger"
        >
          <Trash2 size={12} /> {t('common.delete')}
        </button>
      </div>

      {pendingImage ? (
        <ImagePreviewCrop
          imageSrc={pendingImage}
          onConfirm={(cropped, original) => {
            onPatch({ image: cropped, imageOriginal: original });
            setPendingImage(null);
          }}
          onCancel={() => setPendingImage(null)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface EdgeInspectorProps {
  edge: BoardEdge;
  layers: BoardLayer[];
  nodeTitle: (id: string) => string;
  edgeTitle: (id: string) => string;
  onPatch: (changes: Partial<BoardEdge>) => void;
  onDelete: () => void;
  onDetach: (side: 'sources' | 'targets', endpointId: string) => void;
  onSwap: () => void;
}

export function EdgeInspector({
  edge, layers, nodeTitle, edgeTitle, onPatch, onDelete, onDetach, onSwap,
}: EdgeInspectorProps) {
  const { t } = useTranslation();
  const endpointLabel = (id: string, on: 'node' | 'edge') => (on === 'node' ? nodeTitle(id) : `↝ ${edgeTitle(id)}`);

  return (
    <div className="space-y-3.5">
      <Field label={t('board.inspector.relation')}>
        <div className="flex flex-wrap gap-1">
          {EDGE_KINDS.map((kind) => (
            <button
              key={kind.id}
              type="button"
              onClick={() => onPatch({ kind: kind.id, color: edgeKindColor(kind.id), direction: kind.defaultDirection })}
              className={`rounded-lg border px-2 py-1 text-xs transition ${
                edge.kind === kind.id ? 'text-deep' : 'border-border text-text-muted hover:text-text-primary'
              }`}
              style={
                edge.kind === kind.id
                  ? { background: kind.color, borderColor: kind.color }
                  : { borderColor: undefined }
              }
            >
              {t(kind.labelKey)}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t('board.inspector.label')}>
        <input
          value={edge.label ?? ''}
          onChange={(event) => onPatch({ label: event.target.value })}
          className={inputClass}
          placeholder={t('board.inspector.labelPlaceholder')}
        />
      </Field>

      <div className="rounded-lg border border-border bg-elevated p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-dim">
            {t('board.inspector.endpoints')}
          </span>
          <button
            type="button"
            onClick={onSwap}
            title={t('board.inspector.swap')}
            className="text-text-muted transition hover:text-accent-gold"
          >
            <ArrowLeftRight size={13} />
          </button>
        </div>
        {(['sources', 'targets'] as const).map((side) => (
          <div key={side} className="mb-1.5">
            <span className="text-[10px] uppercase text-text-dim">
              {side === 'sources' ? t('board.inspector.from') : t('board.inspector.to')}
            </span>
            <div className="mt-0.5 space-y-0.5">
              {edge[side].map((endpoint) => (
                <div key={`${side}-${endpoint.id}`} className="flex items-center gap-1 text-xs">
                  <span className="flex-1 truncate text-text-primary">
                    {endpointLabel(endpoint.id, endpoint.on)}
                  </span>
                  {edge[side].length > 1 ? (
                    <button
                      type="button"
                      onClick={() => onDetach(side, endpoint.id)}
                      className="text-text-dim transition hover:text-danger"
                      title={t('common.remove')}
                      aria-label={t('common.remove')}
                    >
                      <Minus size={11} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="text-[10px] leading-snug text-text-dim">{t('board.inspector.endpointsHint')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('board.inspector.weight')}>
          <input
            type="range"
            min={0.2}
            max={4}
            step={0.2}
            value={edge.weight}
            onChange={(event) => onPatch({ weight: Number(event.target.value) })}
            className="w-full accent-accent-gold"
          />
          <span className="text-[11px] text-text-muted">{edge.weight.toFixed(1)}</span>
        </Field>
        <Field label={t('board.inspector.certainty')}>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.1}
            value={edge.certainty}
            onChange={(event) => onPatch({ certainty: Number(event.target.value) })}
            className="w-full accent-accent-plum"
          />
          <span className="text-[11px] text-text-muted">{Math.round(edge.certainty * 100)}%</span>
        </Field>
      </div>

      <Field label={t('board.inspector.direction')}>
        <Choice
          options={DIRECTIONS}
          value={edge.direction}
          onChange={(direction) => onPatch({ direction })}
          labelFor={(value) => t(`board.direction.${value}`)}
        />
      </Field>

      <Field label={t('board.inspector.line')}>
        <div className="space-y-1.5">
          <Choice options={LINE_STYLES} value={edge.style} onChange={(style) => onPatch({ style })} />
          <Choice options={CURVATURES} value={edge.curvature} onChange={(curvature) => onPatch({ curvature })} />
          <div className="flex items-center gap-2">
            <InlineColorPicker value={edge.color} onChange={(color) => onPatch({ color })} size="sm" />
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={edge.width}
              onChange={(event) => onPatch({ width: Number(event.target.value) })}
              className="flex-1 accent-accent-gold"
              title={t('board.inspector.widthHint')}
            />
          </div>
        </div>
      </Field>

      <Field label={t('board.inspector.tags')}>
        <TagEditor tags={edge.tags ?? []} onChange={(tags) => onPatch({ tags })} />
      </Field>

      <Field label={t('board.inspector.notes')}>
        <textarea
          value={edge.notes ?? ''}
          onChange={(event) => onPatch({ notes: event.target.value })}
          rows={3}
          className={`${inputClass} resize-y`}
        />
      </Field>

      <Field label={t('board.inspector.layer')}>
        <select
          value={edge.layerId ?? ''}
          onChange={(event) => onPatch({ layerId: event.target.value || undefined })}
          className={inputClass}
        >
          <option value="">{t('board.layers.none')}</option>
          {layers.map((layer) => (
            <option key={layer.id} value={layer.id}>
              {layer.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <span className="flex items-center gap-1 text-[11px] text-text-dim">
          {edge.direction === 'forward' ? <ArrowRight size={12} /> : null}
          {edge.direction === 'backward' ? <ArrowLeftFromLine size={12} /> : null}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto flex items-center gap-1 rounded-lg border border-danger/40 px-2 py-1 text-xs text-danger"
        >
          <Trash2 size={12} /> {t('common.delete')}
        </button>
      </div>
    </div>
  );
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
