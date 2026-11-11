import type {Editor} from '@tiptap/core';
import {db} from '@/db';
import {getActiveEnginePaneId, getPrimaryEnginePaneOpenBeside} from '@/engines/_shared/EnginePaneContext';
import type {WorldEraScope} from '@/services/worldEras/types';
import type {LocalToolDefinition} from '../sdk';
import type {LocalToolBlockPort} from './client';
import type {LocalToolOwnedBlockDefinition} from './definitions';
import type {LocalToolBlockOwner, LocalToolOwnedBlockEnvelope} from './types';
import type {LocalToolPendingReporter} from './pending';
import {resolveProjectLocalTool} from '../releases';

export interface LiveOwnedBlockPort extends LocalToolBlockPort {
  commit(before: LocalToolOwnedBlockEnvelope, next: LocalToolOwnedBlockEnvelope, isCurrent?: () => boolean): Promise<void>;
}

export interface OwnedBlockBinding {
  scope: WorldEraScope;
  owner: LocalToolBlockOwner;
  blockId: string;
  source: LocalToolDefinition;
  sourcePin: string | null;
  definition: LocalToolOwnedBlockDefinition;
  paneId: string;
  editor: Editor;
  port: LiveOwnedBlockPort;
  report: LocalToolPendingReporter;
  ancestors: string[];
}

export interface OwnedBlockPanelSession extends OwnedBlockBinding {
  token: string;
}

const sessions = new Map<string, OwnedBlockPanelSession>();
const listeners = new Set<() => void>();
const retiring = new Set<string>();
const atoms = new WeakMap<Editor, Map<string, {retired: boolean}>>();

function atomKey(scope: WorldEraScope, owner: LocalToolBlockOwner, blockId: string) {
  return JSON.stringify([scope.projectId, scope.eraId ?? null, owner.kind, owner.documentId, blockId]);
}
function changed() {
  for (const notify of listeners) notify();
}

export function registerOwnedBlockPanel(binding: OwnedBlockBinding) {
  const token = crypto.randomUUID();
  const session = {...binding, token};
  sessions.set(token, session);
  changed();
  return {
    session,
    release() {
      if (sessions.get(token) !== session) return;
      sessions.delete(token);
      changed();
    },
  };
}

export function subscribeOwnedBlockPanels(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}

export function getOwnedBlockPanel(token: string, scope: WorldEraScope, ownerKind: string) {
  const session = sessions.get(token);
  return session && session.scope.projectId === scope.projectId && session.scope.eraId === scope.eraId &&
    session.owner.kind === ownerKind ? session : undefined;
}

function atomState(editor: Editor, key: string) {
  const states = atoms.get(editor) ?? new Map<string, {retired: boolean}>();
  const state = states.get(key) ?? {retired: false};
  states.set(key, state);
  atoms.set(editor, states);
  return state;
}

export function captureOwnedAtomAccess(editor: Editor, scope: WorldEraScope, owner: LocalToolBlockOwner, blockId: string) {
  const key = atomKey(scope, owner, blockId);
  const state = atomState(editor, key);
  return () => {
    if (retiring.has(key) || state.retired) throw Error('local_tool_block_context_expired');
  };
}

/** Exclude queued edits while the exact atom is being removed in the owner transaction. */
export function beginOwnedAtomRemoval(scope: WorldEraScope, owner: LocalToolBlockOwner, blockId: string) {
  const key = atomKey(scope, owner, blockId);
  if (retiring.has(key)) throw Error('local_tool_block_conflict');
  retiring.add(key);
  return () => { retiring.delete(key); };
}

export function retireOwnedAtom(scope: WorldEraScope, owner: LocalToolBlockOwner, blockId: string, editors: readonly Editor[]) {
  const key = atomKey(scope, owner, blockId);
  const targets = new Set(editors);
  let removed = false;
  for (const [token, session] of sessions) {
    if (atomKey(session.scope, session.owner, session.blockId) !== key) continue;
    targets.add(session.editor);
    sessions.delete(token);
    removed = true;
  }
  for (const editor of targets) atomState(editor, key).retired = true;
  if (removed) changed();
}

export function restoreOwnedAtom(scope: WorldEraScope, owner: LocalToolBlockOwner, blockId: string, editors: readonly Editor[]) {
  const key = atomKey(scope, owner, blockId);
  for (const editor of editors) {
    const states = atoms.get(editor);
    if (states?.get(key)?.retired) states.delete(key);
  }
}

export function ownedPanelCurrent(session: OwnedBlockPanelSession) {
  if (sessions.get(session.token) !== session) return false;
  try { session.port.read(); return true; }
  catch { return false; }
}

export async function checkOwnedPanelAccess(session: OwnedBlockPanelSession) {
  if (!ownedPanelCurrent(session)) return false;
  const project = await db.projects.get(session.scope.projectId);
  if (!project || !project.enabledEngines.includes(session.owner.kind) ||
    !project.enabledEngines.includes('local-tool-' + session.source.namespace) ||
    (project.localToolInstallations?.[session.source.namespace]?.contentHash ?? null) !== session.sourcePin) return false;
  try {
    return resolveProjectLocalTool(session.source.namespace, project) === session.source && ownedPanelCurrent(session);
  } catch { return false; }
}

export async function openOwnedBlockPanel(session: OwnedBlockPanelSession | undefined) {
  if (!session || !await checkOwnedPanelAccess(session)) return {available: false, applied: false};
  const {scope, owner, token} = session;
  const open = getPrimaryEnginePaneOpenBeside(scope.projectId);
  if (!open) return {available: false, applied: false};
  const query = new URLSearchParams({ownedBlockSession: token, era: scope.eraId ?? ''});
  const applied = await open('/project/' + encodeURIComponent(scope.projectId) + '/' + owner.kind + '?' + query, async () =>
    getPrimaryEnginePaneOpenBeside(scope.projectId) === open && await checkOwnedPanelAccess(session));
  return {available: applied || await checkOwnedPanelAccess(session) && getPrimaryEnginePaneOpenBeside(scope.projectId) === open, applied};
}

export function findOwnedBlockPanel(scope: WorldEraScope, owner: LocalToolBlockOwner, blockId: string) {
  const key = atomKey(scope, owner, blockId);
  const matches = [...sessions.values()].filter(session => atomKey(session.scope, session.owner, session.blockId) === key &&
    ownedPanelCurrent(session));
  if (matches.length === 1) return matches[0];
  const active = getActiveEnginePaneId();
  const focused = matches.filter(session => session.paneId === active);
  return focused.length === 1 ? focused[0] : undefined;
}
