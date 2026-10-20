import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { Project } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';
import CharacterSheetsEngine from '@/engines/character-sheets/CharacterSheetsEngine';
import { createSheet, presets } from '@/engines/character-sheets/types';
import { d20Check } from '@/engines/character-sheets/mechanics';
import { saveSheet } from '@/engines/character-sheets/operations';
const P = 'visual-rpg-sheets';
async function main() {
  useLocaleStore.setState({ locale: 'es', loaded: true });
  const project: Project = { id: P, title: 'Cuaderno de campaña', description: '', mode: 'custom', type: 'standalone', color: '#000', status: 'draft', enabledEngines: ['character-sheets'], engineOrder: ['character-sheets'], createdAt: 1, updatedAt: 1 };
  await db.projects.put(project);
  const names = ['Maela Voss', 'Centinela de piedra', 'Inés Duarte', 'Luz sobre el puerto', 'Guardián del faro', 'Exploradores del estuario'];
  for (let i = 0; i < presets.length; i++) {
    const sheet = createSheet(presets[i], names[i]);
    if (i === 0) {
      sheet.traits.forEach((trait, index) => { trait.value = [12, 18, 14, 11, 16, 10][index]; }); sheet.numbers.level = 5;
      sheet.skills.find(skill => skill.label === 'Stealth')!.training = 2;
      sheet.rows.push({ id: 'weapon', name: 'Arco de viaje', section: 'Armas', detail: 'Una marca de cobre distingue las flechas del estuario.', quantity: 1, expression: '1d8+4' });
      sheet.resources[0] = { ...sheet.resources[0], max: 38, current: 24 };
      sheet.rolls = [d20Check('Stealth', 10, 18, 'normal', false, () => 14)];
    }
    await saveSheet(P, sheet, null);
  }
  createRoot(document.getElementById('root')!).render(<MemoryRouter><CharacterSheetsEngine projectId={P} /></MemoryRouter>);
}
void main().then(() => { (window as unknown as { __previewReady: boolean }).__previewReady = true; }).catch(error => { (window as unknown as { __previewError: string }).__previewError = String(error); });
