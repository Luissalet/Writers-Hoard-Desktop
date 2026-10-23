import { useState } from 'react';
import { Copy, LayoutList, Pencil, Pin, PinOff, RotateCcw, X } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { useTranslation } from '@/i18n/useTranslation';
import { workspaceCopy } from './copy';
import { routeOf, TAB_LIMIT, type ClosedTab, type PaneTab } from './workspaceTabs';

const tool = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';

export interface WorkspaceTabBarProps {
  tabs: PaneTab[];
  /** Every open tab, including ones whose tool was switched off meanwhile (they count toward the limit). */
  openCount: number;
  activeId?: string;
  engines: EngineDefinition[];
  closed: ClosedTab[];
  busy: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onPin: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseRight: (id: string) => void;
  /** `exact`: that very entry of the recently-closed list, not the next usable one. */
  onReopen: (at: number, exact?: boolean) => void;
}

/** The companion pane's tab strip, the actions for the active tab, and the overview of open tabs. */
export default function WorkspaceTabBar(props: WorkspaceTabBarProps) {
  const { tabs, openCount, activeId, engines, closed, busy } = props;
  const { locale, t } = useTranslation(), copy = workspaceCopy[locale];
  const [renamingId, setRenamingId] = useState<string>(), [draft, setDraft] = useState(''), [overview, setOverview] = useState(false);
  const engineName = (id: string) => { const label = t(`engines.${id}.name`); return label === `engines.${id}.name` ? engines.find(item => item.id === id)?.name ?? id : label; };
  const nameOf = (tab: PaneTab) => tab.label || tab.documentTitle || engineName(tab.engineId);
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0];
  const rightOfActive = active ? tabs.slice(tabs.indexOf(active) + 1).some(tab => !tab.pinned) : false;
  const othersOpen = active ? tabs.some(tab => tab.id !== active.id && !tab.pinned) : false;
  const renaming = !!active && renamingId === active.id;
  const commitRename = () => { if (active) props.onRename(active.id, draft); setRenamingId(undefined); };
  return <>
    <div className="flex flex-wrap gap-1" role="tablist" aria-label={copy.title}>{tabs.map((tab, index) => <div key={tab.id} className="flex min-w-0 items-center">
      <button type="button" role="tab" id={`tab-${tab.id}`} aria-selected={tab.id === active?.id} aria-controls={`panel-${tab.id}`} data-testid={`workspace-tab-${tab.id}`} data-pinned={tab.pinned ? 'true' : undefined} className={`flex min-h-9 max-w-60 items-center gap-1.5 truncate rounded-l-lg border border-border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent-gold ${tab.id === active?.id ? 'bg-elevated text-accent-gold' : 'text-text-muted'}`} onClick={() => props.onSelect(tab.id)}>{tab.pinned && <Pin size={12} aria-hidden="true" className="flex-shrink-0" />}<span className="truncate">{nameOf(tab)} · {index + 1}</span></button>
      <button type="button" className="min-h-9 rounded-r-lg border border-l-0 border-border px-2 text-text-muted hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-40" disabled={busy || !!tab.pinned} title={tab.pinned ? copy.pinnedStays : undefined} aria-label={`${copy.closeTab}: ${engineName(tab.engineId)} ${index + 1}`} data-testid={`workspace-close-tab-${tab.id}`} onClick={() => props.onClose(tab.id)}><X size={13} aria-hidden="true" /></button>
    </div>)}</div>
    <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label={copy.tabTools} data-testid="workspace-tab-tools">
      {active && <>
        <button type="button" className={tool} disabled={busy} data-testid="workspace-tab-rename" onClick={() => { setDraft(active.label ?? ''); setRenamingId(active.id); }}><Pencil size={13} aria-hidden="true" />{copy.rename}</button>
        <button type="button" className={tool} disabled={busy} data-testid="workspace-tab-pin" aria-pressed={!!active.pinned} onClick={() => props.onPin(active.id)}>{active.pinned ? <PinOff size={13} aria-hidden="true" /> : <Pin size={13} aria-hidden="true" />}{active.pinned ? copy.unpin : copy.pin}</button>
        <button type="button" className={tool} disabled={busy || openCount >= TAB_LIMIT} title={openCount >= TAB_LIMIT ? copy.limit : undefined} data-testid="workspace-tab-duplicate" onClick={() => props.onDuplicate(active.id)}><Copy size={13} aria-hidden="true" />{copy.duplicateTab}</button>
        <button type="button" className={tool} disabled={busy || !othersOpen} data-testid="workspace-tab-close-others" onClick={() => props.onCloseOthers(active.id)}>{copy.closeOthers}</button>
        <button type="button" className={tool} disabled={busy || !rightOfActive} data-testid="workspace-tab-close-right" onClick={() => props.onCloseRight(active.id)}>{copy.closeRight}</button>
      </>}
      <button type="button" className={tool} disabled={busy || !closed.length || openCount >= TAB_LIMIT} title={closed.length && openCount >= TAB_LIMIT ? copy.limit : undefined} data-testid="workspace-tab-reopen" onClick={() => props.onReopen(0)}><RotateCcw size={13} aria-hidden="true" />{copy.reopen}</button>
      <button type="button" className={tool} aria-expanded={overview} data-testid="workspace-tab-overview-toggle" onClick={() => setOverview(value => !value)}><LayoutList size={13} aria-hidden="true" />{copy.overview} · {tabs.length}</button>
    </div>
    {renaming && active && <form className="flex flex-wrap items-center gap-2" data-testid="workspace-tab-rename-form" onSubmit={event => { event.preventDefault(); commitRename(); }}>
      <label className="min-w-32 flex-1"><span className="sr-only">{copy.renameLabel}</span><input autoFocus data-testid="workspace-tab-rename-input" aria-label={copy.renameLabel} maxLength={60} placeholder={active.documentTitle || engineName(active.engineId)} className="min-h-9 w-full rounded-lg border border-border bg-deep px-2 text-sm text-text-primary" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setRenamingId(undefined); } }} /></label>
      <button type="submit" className={tool} data-testid="workspace-tab-rename-save">{copy.renameSave}</button>
      <button type="button" className={tool} data-testid="workspace-tab-rename-reset" onClick={() => { props.onRename(active.id, ''); setRenamingId(undefined); }}>{copy.renameReset}</button>
    </form>}
    {overview && <section className="space-y-2 rounded-lg border border-border bg-surface p-2" aria-label={copy.overviewTitle} data-testid="workspace-tab-overview">
      {tabs.length === 0 ? <p className="text-xs text-text-muted">{copy.overviewEmpty}</p> : <ol className="space-y-1">{tabs.map((tab, index) => <li key={tab.id} className="flex items-center gap-2 text-sm" data-testid={`workspace-overview-row-${tab.id}`}>
        <span className="w-5 text-right text-xs text-text-muted">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-text-primary">{tab.pinned && <Pin size={11} aria-hidden="true" className="mr-1 inline" />}{nameOf(tab)}<span className="ml-2 text-xs text-text-muted">{engineName(tab.engineId)}</span></span>
        <button type="button" className={tool} data-testid={`workspace-overview-jump-${tab.id}`} aria-label={`${copy.jump}: ${nameOf(tab)}`} onClick={() => props.onSelect(tab.id)}>{copy.jump}</button>
        <button type="button" className={tool} disabled={busy || !!tab.pinned} data-testid={`workspace-overview-close-${tab.id}`} aria-label={`${copy.closeFromOverview}: ${nameOf(tab)}`} onClick={() => props.onClose(tab.id)}>{copy.closeFromOverview}</button>
      </li>)}</ol>}
      {closed.length > 0 && <div><h4 className="mb-1 text-xs uppercase tracking-wide text-text-muted">{copy.recentlyClosed}</h4><ul className="space-y-1">{closed.map((item, at) => <li key={`${at}:${item.engineId}:${routeOf(item).pathname}${routeOf(item).search}`} className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate text-text-muted">{item.label || item.documentTitle || engineName(item.engineId)}</span>
        <button type="button" className={tool} disabled={busy || openCount >= TAB_LIMIT || !engines.some(engine => engine.id === item.engineId)} data-testid={`workspace-overview-reopen-${at}`} onClick={() => props.onReopen(at, true)}>{copy.reopen}</button>
      </li>)}</ul></div>}
    </section>}
  </>;
}
