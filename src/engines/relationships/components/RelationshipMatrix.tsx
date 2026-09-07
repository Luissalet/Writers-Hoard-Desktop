import { ArrowRight, ArrowLeftRight, ExternalLink, Plus, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { getRelationshipsCopy, pairText } from '../copy';
import { relationshipPairKey } from '../matrix';
import { RELATIONSHIP_KIND_CONFIG, RELATIONSHIP_STATE_CONFIG, type Relationship } from '../types';

export interface MatrixCharacter { id: string; title: string }
export type CharacterPair = [MatrixCharacter, MatrixCharacter];

export function RelationshipMatrix({ characters, relationshipIndex, selectedPair, onPair, onOpenCharacter }: {
  characters: MatrixCharacter[];
  relationshipIndex: Map<string, Relationship[]>;
  selectedPair: CharacterPair | null;
  onPair: (pair: CharacterPair, relationships: Relationship[]) => void;
  onOpenCharacter: (character: MatrixCharacter) => void;
}) {
  const { t, locale } = useTranslation();
  const copy = getRelationshipsCopy(locale);
  const selectedKey = selectedPair ? relationshipPairKey(selectedPair[0].id, selectedPair[1].id) : null;
  return <div className="space-y-3">
    <p className="max-w-3xl text-sm leading-relaxed text-text-muted">{copy.matrixHint}</p>
    <div className="max-h-[65vh] overflow-auto rounded-xl border border-border bg-surface">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">{t('relationships.view.matrix')}. {copy.directionHint}</caption>
        <thead><tr><th className="sticky left-0 top-0 z-20 min-w-36 border-b border-r border-border bg-surface p-3 text-left">{t('relationships.entityA')}</th>
          {characters.map((character) => <th key={character.id} scope="col" className="sticky top-0 z-10 min-w-28 max-w-44 border-b border-border bg-surface px-3 py-3 font-medium text-text-primary">
            <button type="button" onClick={() => onOpenCharacter(character)} title={copy.openCharacter.replace('{name}', character.title)} className="max-w-40 truncate rounded px-1 py-1 hover:text-accent-gold focus-visible:outline-2 focus-visible:outline-accent-gold">{character.title}</button>
          </th>)}
        </tr></thead>
        <tbody>{characters.map((row, rowIndex) => <tr key={row.id}>
          <th scope="row" className="sticky left-0 z-10 max-w-48 border-r border-border bg-surface p-3 text-left font-medium text-text-primary"><button type="button" onClick={() => onOpenCharacter(row)} title={copy.openCharacter.replace('{name}', row.title)} className="max-w-40 truncate rounded px-1 py-1 hover:text-accent-gold focus-visible:outline-2 focus-visible:outline-accent-gold">{row.title}</button></th>
          {characters.map((col, colIndex) => {
            if (row.id === col.id) return <td key={col.id} aria-label={row.title} className="border border-border/40 bg-elevated/40 text-center text-text-dim">—</td>;
            const key = relationshipPairKey(row.id, col.id);
            const rows = relationshipIndex.get(key) ?? [];
            const title = pairText(rows.length ? copy.pairCount : copy.emptyCell, row.title, col.title, rows.length);
            return <td key={col.id} className="h-20 border border-border/40 p-1">
              <button type="button" data-matrix-row={rowIndex} data-matrix-col={colIndex} aria-label={title} aria-pressed={key === selectedKey} onClick={() => onPair([row, col], rows)}
                onKeyDown={(event) => {
                  const direction = ({ ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] } as Record<string, number[]>)[event.key];
                  if (!direction) return;
                  event.preventDefault();
                  let r = rowIndex + direction[0]; let c = colIndex + direction[1];
                  if (r === c) { r += direction[0]; c += direction[1]; }
                  event.currentTarget.closest('table')?.querySelector<HTMLElement>(`[data-matrix-row="${r}"][data-matrix-col="${c}"]`)?.focus();
                }}
                className={`flex h-full min-h-16 w-full min-w-24 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-text-primary transition hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-gold ${key === selectedKey ? 'bg-accent-gold/15 ring-1 ring-accent-gold/60' : ''}`}>
                {rows.length ? <><span className="text-xs font-medium">{rows.length === 1 ? t(RELATIONSHIP_KIND_CONFIG[rows[0].kind]?.labelKey ?? '') : copy.relationCount.replace('{count}', String(rows.length))}</span><span className="flex gap-1" aria-hidden="true">{rows.slice(0, 5).map((rel) => <span key={rel.id} className="h-1.5 w-3 rounded-sm" style={{ backgroundColor: rel.color ?? RELATIONSHIP_KIND_CONFIG[rel.kind]?.color }} />)}</span></> : <Plus size={15} className="text-text-muted" />}
              </button>
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <p className="text-xs text-text-muted">{copy.directionHint}</p>
  </div>;
}

export function PairRelationships({ pair, relationships, onCreate, onEdit, onClose, onOpenCharacter }: {
  pair: CharacterPair; relationships: Relationship[];
  onCreate: () => void; onEdit: (row: Relationship) => void; onClose: () => void;
  onOpenCharacter: (character: MatrixCharacter) => void;
}) {
  const { t, locale } = useTranslation();
  const copy = getRelationshipsCopy(locale);
  const title = pairText(copy.pairTitle, pair[0].title, pair[1].title);
  return <section aria-label={title} className="rounded-xl border border-border bg-surface p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-serif text-lg text-text-primary">{title}</h3><div className="mt-2 flex flex-wrap gap-3">{pair.map((character) => <button type="button" key={character.id} onClick={() => onOpenCharacter(character)} title={copy.openCharacter.replace('{name}', character.title)} className="flex items-center gap-1.5 rounded text-xs text-accent-gold hover:underline focus-visible:outline-2 focus-visible:outline-accent-gold"><ExternalLink size={12}/>{character.title}</button>)}</div></div>
      <div className="flex items-center gap-2"><button type="button" onClick={onCreate} className="flex items-center gap-1.5 rounded-lg bg-accent-gold px-3 py-2 text-xs font-semibold text-deep hover:bg-accent-gold/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold"><Plus size={14}/>{copy.addAnother}</button><button type="button" aria-label={copy.closePair} onClick={onClose} className="rounded p-2 text-text-muted hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold"><X size={16}/></button></div>
    </div>
    {relationships.length ? <ul className="mt-4 divide-y divide-border">{relationships.map((rel) => {
      const cfg = RELATIONSHIP_KIND_CONFIG[rel.kind];
      const aName = pair.find((character) => character.id === rel.entityAId)?.title ?? rel.entityAName;
      const bName = pair.find((character) => character.id === rel.entityBId)?.title ?? rel.entityBName;
      const Direction = rel.directional ? ArrowRight : ArrowLeftRight;
      return <li key={rel.id}><button type="button" onClick={() => onEdit(rel)} className="flex w-full flex-col gap-1.5 rounded-lg px-2 py-3 text-left hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: rel.color ?? cfg?.color }} aria-hidden="true"/>{rel.label || t(cfg?.labelKey ?? '')}<span className="text-xs font-normal text-text-muted">{t(RELATIONSHIP_STATE_CONFIG[rel.state]?.labelKey ?? '')}</span></span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">{aName}<Direction size={12} aria-label={rel.directional ? t('relationships.directional') : undefined}/>{bName}<span className="ml-2">{t(cfg?.labelKey ?? '')} · {t('relationships.intensity')}: {rel.intensity > 0 ? '+' : ''}{rel.intensity}</span></span>
        {rel.notes && <span className="line-clamp-2 text-xs leading-relaxed text-text-muted">{rel.notes}</span>}
      </button></li>;
    })}</ul> : <p className="mt-4 text-sm text-text-muted">{copy.pairEmpty}</p>}
  </section>;
}
