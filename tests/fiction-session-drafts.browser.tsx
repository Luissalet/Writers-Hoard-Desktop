import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '@/engines/fiction/native/lib/api';
import { SessionsPage } from '@/engines/fiction/native/pages/SessionsPage';
import { collectEditors, scheduleRefresh } from '@/engines/fiction/native/lib/copilot-context';
import type { SessionDetailsPatch, SessionWithDetails, World } from '@/engines/fiction/native/lib/types';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));

export async function testFictionSessionDrafts(): Promise<string[]> {
  const original = { ...api }, host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), passed: string[] = [];
  const makeRow = (id: string, world = 'draft-world'): SessionWithDetails => ({
    session: { id, world_id: world, title: id, started_at: 1, ended_at: null }, is_current: false,
    details: { session_id: id, scheduled_at: null, timezone: '', length_min: null, place: `${world}-${id}`, hook: 'Original hook', dm_notes: '', status: 'planned', recap: '', recap_posted: false, attendance: [], updated_at: 1 },
  });
  const rows = [makeRow('Alpha'), makeRow('Beta')], other = makeRow('Alpha', 'other-world');
  const fail = new Set(['Alpha', 'Beta']), patches: SessionDetailsPatch[] = [];
  api.listSessionDetails = async world => ({ sessions: structuredClone(world === 'other-world' ? [other] : rows) });
  api.listEntities = async () => [];
  api.updateSessionDetails = async (_world, id, patch) => {
    if (fail.delete(id)) throw new Error(`Save failed ${id}`);
    patches.push(structuredClone(patch));
    const row = rows.find(candidate => candidate.session.id === id)!;
    row.details = { ...row.details!, ...patch };
    return structuredClone(row);
  };
  const detailButtons = () => [...host.querySelectorAll<HTMLButtonElement>('button')].filter(button => button.textContent === 'Preparation and recap');
  const field = (label: string) => [...host.querySelectorAll('label')].find(node => node.firstChild?.textContent === label)?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea');
  const click = async (button: HTMLButtonElement | undefined | null) => { assert(button, 'Expected button'); await act(async () => { button!.click(); await pause(); }); };
  const change = async (label: string, value: string) => {
    const element = field(label); assert(element, `Expected ${label}`);
    await act(async () => {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
      element!.dispatchEvent(new Event('input', { bubbles: true })); await pause();
    });
  };
  const save = () => click([...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Save preparation and draft'));
  const close = () => click(host.querySelector('button[aria-label="Close preparation"]'));
  const refresh = async () => { await act(async () => { scheduleRefresh(); await pause(320); }); };
  try {
    await act(async () => { root.render(<SessionsPage world={{ id: 'draft-world', name: 'Draft' } as World} lang="en" />); await pause(); });
    await click(detailButtons()[0]);
    await change('Place', 'Unsaved Alpha'); await change('GM notes (private)', 'SECRET ALPHA');
    await save(); assert(host.textContent?.includes('Save failed Alpha'), 'Failure must be visible before close');
    await close(); assert(host.querySelectorAll('.session-prep').length === 0 && collectEditors().length === 0, 'Closed forms must not remain mounted or register copilot editors');
    await click(detailButtons()[1]); await change('Place', 'Unsaved Beta'); await save();
    assert(host.textContent?.includes('Save failed Beta'), 'Second session failure');
    await click(detailButtons()[0]);
    assert(host.querySelectorAll('.session-prep').length === 1 && field('Place')?.value === 'Unsaved Alpha' && host.textContent?.includes('Save failed Alpha'), 'Switching sessions retains first draft/error without mounting both forms');
    assert(field('GM notes (private)')?.value === 'SECRET ALPHA' && !JSON.stringify(collectEditors()).includes('SECRET'), 'Private draft retained locally and excluded from copilot');
    await close();
    rows[0].details!.hook = 'Refreshed untouched hook'; rows[0].details!.place = 'Remote place';
    await refresh(); await click(detailButtons()[0]);
    assert(field('Place')?.value === 'Unsaved Alpha' && field('Opening hook')?.value === 'Refreshed untouched hook' && host.textContent?.includes('Save failed Alpha'), 'Reopened draft rebases untouched fields but retains edits/error');
    passed.push('Close/reopen and switch preserve per-session drafts/errors; hidden forms never mount or publish private context');
    const date = '2026-10-25T18:30', zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await change('Scheduled date and time', date); await save();
    assert(patches.at(-1)?.scheduled_at === new Date(date).getTime() / 1000 && patches.at(-1)?.timezone === zone, 'Real input event sends correct Unix seconds and local timezone');
    assert(field('Scheduled date and time')?.value === date && !host.textContent?.includes('Save failed Alpha'), 'Successful save retains date and clears remembered error');
    await close(); rows[0].details!.place = 'Changed after save'; await refresh(); await click(detailButtons()[0]);
    assert(field('Place')?.value === 'Changed after save', 'Successful save updates remembered baseline, so later untouched refresh follows stored data');
    await change('Scheduled date and time', ''); await save();
    assert(patches.at(-1)?.scheduled_at === null && field('Scheduled date and time')?.value === '', 'Date clearing sends null and stays cleared after refresh');
    await close(); await click(detailButtons()[1]);
    assert(field('Place')?.value === 'Unsaved Beta' && host.textContent?.includes('Save failed Beta'), 'Saving another session cannot clear this draft/error');
    passed.push('Successful save rebases cache; date input persists exact epoch/zone and explicit clearing sends null');
    await close();
    await act(async () => { root.render(<SessionsPage world={{ id: 'other-world', name: 'Other' } as World} lang="en" />); await pause(); });
    await click(detailButtons()[0]); assert(field('Place')?.value === 'other-world-Alpha' && !host.textContent?.includes('Save failed Alpha'), 'A reused session id in another world cannot receive a draft or error');
    await close();
    await act(async () => { root.render(<SessionsPage world={{ id: 'draft-world', name: 'Draft' } as World} lang="en" />); await pause(); });
    await click(detailButtons()[1]); assert(field('Place')?.value === 'Unsaved Beta' && host.textContent?.includes('Save failed Beta'), 'Returning to original world restores its own session draft');
    passed.push('Draft/error cache isolates worlds even if their session ids match');
    await close(); await click(detailButtons()[0]);
    let resolvePending!: (row: SessionWithDetails) => void;
    let rejectPending!: (error: Error) => void;
    api.updateSessionDetails = async () => new Promise((resolve, reject) => { resolvePending = resolve; rejectPending = reject; });
    await change('Place', 'Pending successful save'); await save(); await click(detailButtons()[1]);
    rows[0].details!.place = 'Pending successful save';
    await act(async () => { resolvePending(structuredClone(rows[0])); await pause(); });
    await close(); rows[0].details!.place = 'Changed after background save'; await refresh(); await click(detailButtons()[0]);
    assert(field('Place')?.value === 'Changed after background save', 'Successful pending save updates cached baseline even after its form was unmounted');
    await change('Place', 'Pending failed draft'); await save(); await click(detailButtons()[1]);
    await act(async () => { rejectPending(new Error('Background save failed Alpha')); await pause(); });
    await click(detailButtons()[0]);
    assert(field('Place')?.value === 'Pending failed draft' && host.textContent?.includes('Background save failed Alpha'), 'Failed pending save preserves cached draft/error after switching away');
    assert(host.querySelectorAll('.session-prep').length === 1 && !JSON.stringify(collectEditors()).includes('SECRET'), 'Only the active form publishes public context');
    passed.push('Pending save completion updates the correct remembered session after its form unmounts');
    await change('Place', 'Earlier request'); await save(); await click(detailButtons()[1]);
    await click(detailButtons()[0]); await change('Place', 'Newer reopened draft'); await close();
    rows[0].details!.place = 'Earlier request';
    await act(async () => { resolvePending(structuredClone(rows[0])); await pause(); });
    await click(detailButtons()[0]);
    assert(field('Place')?.value === 'Newer reopened draft', 'An earlier form request must not overwrite a newer reopened-and-closed draft');
    passed.push('An older unmounted form response cannot replace a newer draft from the same session');
    return passed;
  } finally { Object.assign(api, original); await act(async () => root.unmount()); host.remove(); }
}
