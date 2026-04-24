import { Sprout } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import {
  registerAnchorAdapter,
  navigateTo,
  getCurrentProjectIdFromUrl,
} from '@/engines/_shared/anchoring';
import { t } from '@/i18n/useTranslation';
import { db } from '@/db';
import SeedsEngine from './components/SeedsEngine';

const seedsEngine: EngineDefinition = {
  id: 'seeds',
  name: 'Seeds & Payoffs',
  description: 'Track foreshadowing, Chekhov\'s guns, and callback payoffs',
  icon: Sprout,
  category: 'planning',
  tables: {
    seeds: 'id, projectId, kind, status, plantedAt',
    payoffs: 'id, seedId, projectId, paidAt',
  },
  component: SeedsEngine,
};

registerEngine(seedsEngine);

registerEntityResolver({
  engineId: 'seeds',
  entityTypes: ['seed', 'payoff'],
  resolveEntity: async (entityId: string, entityType: string) => {
    if (entityType === 'seed') {
      const seed = await db.seeds.get(entityId);
      if (!seed) return null;
      return {
        id: seed.id,
        type: 'seed',
        engineId: 'seeds',
        title: seed.title,
        color: seed.color,
      };
    }
    const payoff = await db.payoffs.get(entityId);
    if (!payoff) return null;
    const seed = await db.seeds.get(payoff.seedId);
    return {
      id: payoff.id,
      type: 'payoff',
      engineId: 'seeds',
      title: payoff.title,
      subtitle: seed?.title,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const seeds = await db.seeds.filter(s => s.title.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)).toArray();
    const payoffs = await db.payoffs.filter(p => p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)).toArray();
    return [
      ...seeds.map(s => ({ id: s.id, type: 'seed' as const, engineId: 'seeds', title: s.title })),
      ...payoffs.map(p => ({ id: p.id, type: 'payoff' as const, engineId: 'seeds', title: p.title })),
    ];
  },
});

registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'seeds',
  tables: ['seeds', 'payoffs'],
}));

registerAnchorAdapter({
  engineId: 'seeds',
  supportsTextRange: true,
  async getEntityText(entityId: string) {
    const seed = await db.seeds.get(entityId);
    if (seed) return seed.description ?? '';
    const payoff = await db.payoffs.get(entityId);
    return payoff?.description ?? '';
  },
  async getEntityTitle(entityId: string) {
    const seed = await db.seeds.get(entityId);
    if (seed) return seed.title;
    const payoff = await db.payoffs.get(entityId);
    return payoff?.title ?? null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.seeds'),
  navigateToEntity(entityId: string) {
    const pid = getCurrentProjectIdFromUrl();
    if (!pid) return;
    navigateTo(`/project/${pid}/seeds?seed=${encodeURIComponent(entityId)}`);
  },
});

export { seedsEngine };
