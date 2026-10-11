import { createRoot } from 'react-dom/client';
import WorldBiblePanel from '@/components/project/WorldBiblePanel';
import { BIBLE_FIXTURE_ID, seedBibleFixture } from './world-bible.browser';
import { useLocaleStore } from '@/stores/localeStore';
import '@/index.css';
await seedBibleFixture();
await useLocaleStore.getState().setLocale('es');
createRoot(document.getElementById('root')!).render(<main style={{ padding: 24 }}><WorldBiblePanel projectId={BIBLE_FIXTURE_ID} /></main>);
