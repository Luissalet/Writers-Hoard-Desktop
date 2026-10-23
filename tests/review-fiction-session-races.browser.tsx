import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '@/engines/fiction/native/lib/api';
import { SessionDetailsForm } from '@/engines/fiction/native/pages/SessionDetailsForm';
import { SessionsPage } from '@/engines/fiction/native/pages/SessionsPage';
import type { SessionWithDetails, World } from '@/engines/fiction/native/lib/types';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
function input(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function testReviewFictionRaces(): Promise<string[]> {
  const original = { ...api }, host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), failures: string[] = [], passed: string[] = [];
  const row: SessionWithDetails = { session: { id: 'race-s', world_id: 'race-w', title: 'Race', started_at: 1, ended_at: null }, is_current: false,
    details: { session_id: 'race-s', scheduled_at: null, timezone: '', length_min: null, place: '', hook: '', dm_notes: '', status: 'planned', recap: '', recap_posted: false, attendance: [], updated_at: 1 } };
  try {
    api.listEntities = async () => [];
    let finishSave!: (value: SessionWithDetails) => void;
    api.updateSessionDetails = async () => new Promise(resolve => { finishSave = resolve; });
    await act(async () => { root.render(<SessionDetailsForm row={row} worldId="race-w" lang="en" onSaved={async () => {}} onDownload={async () => {}} onClose={() => {}} />); await pause(); });
    const place = [...host.querySelectorAll('label')].find(label => label.firstChild?.textContent === 'Place')?.querySelector('input') as HTMLInputElement;
    assert(place, 'Place field');
    await act(async () => { input(place, 'Sent value'); await pause(); });
    const save = [...host.querySelectorAll('button')].find(button => button.textContent === 'Save preparation and draft')!;
    await act(async () => { save.click(); await pause(); });
    if (!place.matches(':disabled')) failures.push('Preparation fields remain editable while a save is pending');
    await act(async () => { finishSave({ ...row, details: { ...row.details!, place: 'Sent value' } }); await pause(); });
    if (place.value !== 'Sent value' || place.matches(':disabled')) failures.push('Successful delayed save did not retain sent text and restore editing');
    else passed.push('Pending preparation save disables editing; sent text remains and editing resumes after success');
    let planCalls = 0;
    let finishPlan!: (value: SessionWithDetails) => void;
    api.listSessionDetails = async () => ({ sessions: [] });
    api.planSession = async () => { planCalls++; return new Promise(resolve => { finishPlan = resolve; }); };
    await act(async () => { root.render(<SessionsPage world={{ id: 'race-w', name: 'Race' } as World} lang="en" />); await pause(); });
    const plan = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Plan session'))!;
    await act(async () => { plan.click(); await pause(); });
    const title = host.querySelector<HTMLInputElement>('input')!;
    await act(async () => { input(title, 'One plan'); await pause(); });
    await act(async () => { title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(); });
    await act(async () => { title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(); });
    if (planCalls !== 1) failures.push(`Enter while plan creation is pending issued ${planCalls} creates`);
    else passed.push('Pending plan creation ignores repeated Enter');
    await act(async () => { finishPlan(row); await pause(); });
    api.listSessionDetails = async () => ({ sessions: [structuredClone(row)] });
    let renameCalls = 0;
    let finishRename!: (value: SessionWithDetails['session']) => void;
    api.renameSession = async () => { renameCalls++; return new Promise(resolve => { finishRename = resolve; }); };
    await act(async () => { root.render(<SessionsPage key="rename" world={{ id: 'race-w', name: 'Race' } as World} lang="en" />); await pause(); });
    const rename = host.querySelector<HTMLButtonElement>('button[aria-label="Rename"]')!;
    await act(async () => { rename.click(); await pause(); });
    const renamedTitle = host.querySelector<HTMLInputElement>('input[aria-label="New session title"]')!;
    await act(async () => { input(renamedTitle, 'Renamed once'); await pause(); });
    await act(async () => { renamedTitle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(); });
    await act(async () => { renamedTitle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(); });
    if (renameCalls !== 1) failures.push(`Enter while rename is pending issued ${renameCalls} writes`);
    else passed.push('Pending session rename ignores repeated Enter');
    await act(async () => { finishRename({ ...row.session, title: 'Renamed once' }); await pause(); });
    if (failures.length) throw new Error(failures.join('\n'));
    return passed;
  } finally { Object.assign(api, original); await act(async () => root.unmount()); host.remove(); }
}
