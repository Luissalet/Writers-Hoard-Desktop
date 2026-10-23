import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionsPage } from '../src/engines/fiction/native/pages/SessionsPage';
import { api } from '../src/engines/fiction/native/lib/api';
import { collectEditors } from '../src/engines/fiction/native/lib/copilot-context';
import type { Entity, SessionDetails, SessionDetailsPatch, SessionWithDetails, World } from '../src/engines/fiction/native/lib/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function testFictionSessions() {
  const original = { ...api };
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const row: SessionWithDetails = { session: { id: 's_qa', world_id: 'w_qa', title: 'Synthetic session', started_at: 1_700_000_000, ended_at: null }, is_current: false,
    details: { session_id: 's_qa', scheduled_at: null, timezone: '', length_min: null, place: '', hook: '', dm_notes: '', status: 'planned', recap: '', recap_posted: false, attendance: [], updated_at: 1 } };
  const rows = [row];
  const updates: SessionDetailsPatch[] = [];
  let failNext = false;
  let character = { id: 'e_qa', name: 'Synthetic character', status: 'alive', kind: 'character' } as Entity;
  api.listSessionDetails = async () => ({ sessions: structuredClone(rows) });
  api.listEntities = async () => [structuredClone(character)];
  api.updateSessionDetails = async (_world, _session, patch) => {
    updates.push(structuredClone(patch));
    if (failNext) { failNext = false; throw Error('Synthetic save failure'); }
    row.details = { ...row.details, ...patch } as SessionDetails;
    if (patch.recap_posted) { row.details.status = 'played'; row.details.recap_posted = true; }
    row.is_current = row.details.status === 'live';
    return structuredClone(row);
  };
  api.patchEntity = async (_world, _id, patch) => { character = { ...character, ...patch }; return character; };
  api.planSession = async () => structuredClone(row);
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === text) ?? null;
  const click = async (element: HTMLElement | null) => { assert(element, 'missing button'); await act(async () => element.click()); await settle(); };
  const field = (text: string) => [...host.querySelectorAll('label')].find(element => element.firstChild?.textContent === text)?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select') ?? null;
  const input = async (text: string, value: string) => {
    const element = field(text); assert(element, `missing field ${text}`);
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    }); await settle();
  };
  const world = { id: 'w_qa', name: 'Synthetic world' } as World;
  try {
    await act(async () => root.render(<SessionsPage world={world} lang="es" />)); await settle();
    assert(button('Iniciar sesión nueva') && button('Planificar sesión'), 'planning hides the original start action');
    await click(button('Preparación y resumen'));
    await input('Lugar', 'Local draft'); await input('Notas DM (privadas)', 'SECRET DM DRAFT');
    const snapshot = JSON.stringify(collectEditors());
    assert(!snapshot.includes('SECRET') && snapshot.includes('Local draft'), 'DM notes leaked into copilot context');
    failNext = true;
    await click(button('Guardar preparación y borrador'));
    assert(field('Lugar')?.value === 'Local draft' && host.textContent?.includes('Synthetic save failure'), 'failed save lost draft');
    await click(button('Guardar preparación y borrador'));
    assert(row.details?.place === 'Local draft' && row.details.dm_notes === 'SECRET DM DRAFT', 'save failed');
    await click(button('Añadir participante'));
    await input('Nombre del participante', 'Synthetic player');
    await input('Personaje (opcional)', 'e_qa');
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]'); assert(checkbox, 'missing attendance checkbox');
    await click(checkbox);
    await input('Resumen de la sesión', 'The party found the key.');
    await click(button('Guardar resumen listo y marcar jugada'));
    assert(row.details?.status === 'played' && row.details.recap_posted, 'ready recap did not mark played');
    assert(row.details.attendance[0].entity_id === 'e_qa' && row.details.attendance[0].present, 'attendance not saved');
    await click(button('Retirar personaje: Synthetic character'));
    assert(character.status === 'retired', 'session-end retire did not use entity patch');
    assert(updates.some(patch => patch.recap_posted === true), 'ready action not explicit');
    await act(async () => root.render(<SessionsPage world={world} lang="en" />)); await settle();
    assert(host.textContent?.includes('Preparation and recap'), 'English session labels missing');
    return ['Session UI preserves start, plans independently and edits metadata inline', 'Save error preserves draft; private DM notes excluded from copilot context',
      'Attendance and ready recap saved explicitly; session-end retire uses existing entity patch', 'Session UI labels in Spanish and English'];
  } finally { Object.assign(api, original); await act(async () => root.unmount()); host.remove(); }
}
