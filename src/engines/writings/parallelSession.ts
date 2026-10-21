import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { clearWritingRecoveryDraft, inspectWritingRecoveryDraft, writeWritingRecoveryDraft, registerWritingRecoveryOwner } from './recoveryJournal';
import { loadPaneDocument, paneTargetKey, PaneConflictError, savePaneDocument, snapshotPaneText, type PaneDocument } from './parallelDrafts';
import { eraSnapshotOperations } from '@/services/worldEras/writings';

export type PaneSaveStatus = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';
export interface PaneState { content: string; status: PaneSaveStatus; incoming: PaneDocument | null; recovered: boolean; error: string | null; version: number }
export const paneJournalId = (paneId: string, document: PaneDocument) => `parallel:${paneId}:${paneTargetKey(document)}`;

/** Merge only independently edited top-level blocks. Ambiguity is a conflict. */
export function mergeSeparateBlocks(base: string, ours: string, theirs: string): string | null {
  if (ours === theirs) return ours;
  if (ours === base) return theirs;
  if (theirs === base) return ours;
  const blocks = (html: string) => [...new DOMParser().parseFromString(sanitizeRichHtml(html), 'text/html').body.childNodes].map(node => node instanceof Element ? node.outerHTML : node.textContent ?? '');
  const b = blocks(base), a = blocks(ours), c = blocks(theirs);
  if (b.length !== a.length || b.length !== c.length || !b.length) return null;
  const result: string[] = [];
  for (let i = 0; i < b.length; i++) {
    if (a[i] === c[i]) result.push(a[i]);
    else if (a[i] === b[i]) result.push(c[i]);
    else if (c[i] === b[i]) result.push(a[i]);
    else return null;
  }
  return result.join('');
}

/** A pane owns one document, one version token and one independent journal. */
export class ParallelEditorSession {
  document: PaneDocument;
  state: PaneState;
  readonly journalId: string;
  private listener: ((state: PaneState) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<boolean> | null = null;
  private queuedRemote: PaneDocument | null = null;
  private disposed = false;
  private saver: typeof savePaneDocument;
  private recoveryOwner?: string;
  private releaseRecoveryOwner: () => void;

  constructor(document: PaneDocument, paneId: string, saver = savePaneDocument, recoveryOwner?: string) {
    this.document = document; this.journalId = paneJournalId(paneId, document); this.saver = saver;
    this.recoveryOwner = recoveryOwner;
    this.releaseRecoveryOwner = registerWritingRecoveryOwner(document.projectId, this.journalId, recoveryOwner);
    const recovery = inspectWritingRecoveryDraft({ id: this.journalId, projectId: document.projectId, title: this.journalId, content: document.content }, recoveryOwner);
    this.state = { content: recovery.kind === 'none' ? document.content : recovery.draft.content, status: recovery.kind === 'none' ? 'saved' : recovery.kind === 'draft' ? 'dirty' : 'conflict', incoming: recovery.kind === 'conflict' ? document : null, recovered: recovery.kind !== 'none', error: null, version: document.version };
    // A conflicted journal must keep its OLD baseline. Re-basing it onto the
    // current row would turn the next reopen into an automatic overwrite.
    if (recovery.kind === 'conflict') this.document = { ...document, content: recovery.draft.baseContent };
    if (!document.draftId) void eraSnapshotOperations(document).takeSnapshot({ id: document.writingId, projectId: document.projectId, title: document.title, content: document.content }, 'auto');
    if (this.state.status === 'dirty') this.schedule();
  }
  subscribe(listener: (state: PaneState) => void): () => void { this.listener = listener; listener(this.state); return () => { if (this.listener === listener) this.listener = null; }; }
  private publish(patch: Partial<PaneState>) { this.state = { ...this.state, ...patch }; if (!this.disposed) this.listener?.(this.state); }
  private persist() {
    if (this.state.content === this.document.content && !this.state.incoming) { clearWritingRecoveryDraft(this.document.projectId, this.journalId, this.recoveryOwner); return; }
    writeWritingRecoveryDraft(this.document.projectId, this.journalId, this.journalId, this.state.content, this.journalId, this.document.content, this.recoveryOwner);
  }
  private schedule() { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 1000); }
  get dirty() { return this.state.content !== this.document.content || !!this.state.incoming; }
  get mergeCandidate() { return this.state.incoming ? mergeSeparateBlocks(this.document.content, this.state.content, this.state.incoming.content) : null; }
  change(content: string) {
    this.publish({ content, error: null, status: this.state.incoming ? 'conflict' : content === this.document.content ? 'saved' : 'dirty' });
    this.persist(); if (!this.state.incoming) this.schedule();
  }
  receive(document: PaneDocument) {
    if (document.version === this.document.version) return;
    if (this.pending) { this.queuedRemote = document; return; }
    if (document.content === this.document.content) {
      this.document = document; this.publish({ version: document.version }); this.persist(); return;
    }
    if (!this.dirty || document.content === this.state.content) {
      this.document = document; this.publish({ content: document.content, status: 'saved', incoming: null, version: document.version, error: null }); this.persist(); return;
    }
    this.publish({ incoming: document, status: 'conflict', error: null }); this.persist();
  }
  flush(): Promise<boolean> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.pending) return this.pending;
    if (this.state.incoming) return Promise.resolve(false);
    if (!this.dirty) return Promise.resolve(true);
    this.persist();
    const run = async () => {
      while (this.state.content !== this.document.content && !this.state.incoming) {
        const content = this.state.content;
        this.publish({ status: 'saving', error: null });
        try {
          const version = await this.saver(this.document, content);
          this.document = { ...this.document, content, version };
          this.publish({ status: this.state.content === content ? 'saved' : 'dirty', version }); this.persist();
        } catch (error) {
          if (error instanceof PaneConflictError) this.publish({ status: 'conflict', incoming: error.current, error: null });
          else this.publish({ status: 'error', error: error instanceof Error ? error.message : String(error) });
          this.persist(); return false;
        }
      }
      return !this.state.incoming;
    };
    this.pending = run().finally(() => {
      this.pending = null;
      const remote = this.queuedRemote; this.queuedRemote = null;
      if (remote && remote.version > this.document.version) this.receive(remote);
    });
    return this.pending;
  }
  async useSaved(): Promise<boolean> {
    const incoming = this.state.incoming; if (!incoming) return true;
    const content = this.state.content;
    try {
      await snapshotPaneText(this.document, this.state.content);
      const latest = await loadPaneDocument(this.document.projectId, this.document, this.document.eraId);
      if (this.state.content !== content) { this.publish({ incoming: latest, status: 'conflict' }); this.persist(); return false; }
      this.document = latest; this.publish({ content: latest.content, incoming: null, status: 'saved', error: null, version: latest.version }); this.persist(); return true;
    } catch (error) { this.publish({ error: String(error) }); return false; }
  }
  async keepMine(merge = false): Promise<boolean> {
    const incoming = this.state.incoming; if (!incoming) return this.flush();
    const content = merge ? this.mergeCandidate : this.state.content;
    const original = this.state.content;
    if (content === null) return false;
    try {
      await snapshotPaneText(this.document, this.state.content);
      const version = await this.saver(incoming, content, true);
      if (merge && this.state.content !== original) { this.publish({ incoming: { ...incoming, content, version }, status: 'conflict' }); this.persist(); return false; }
      const latest = this.state.content === original ? content : this.state.content;
      this.document = { ...incoming, content, version };
      this.publish({ content: latest, incoming: null, status: latest === content ? 'saved' : 'dirty', version, error: null }); this.persist(); if (latest !== content) this.schedule(); return true;
    } catch (error) {
      if (error instanceof PaneConflictError) this.publish({ incoming: error.current, status: 'conflict', error: null });
      else this.publish({ error: String(error) });
      this.persist(); return false;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.listener = null; this.persist(); if (this.timer) clearTimeout(this.timer);
    void this.flush().finally(() => this.releaseRecoveryOwner());
  }
}
