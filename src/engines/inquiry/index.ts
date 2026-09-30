import { lazy } from 'react';

// ============================================
// Investigation — engine registration
// ============================================
//
// Turns the research a project already holds (citations with verbatim
// excerpts) into claims, and reasons about them: which ones are backed by
// independent sources, what was true when, which hypothesis the evidence
// contradicts least. Nothing stores a verdict; see ./types.ts and ./derive.ts.

import { FileSearch } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerAnchorAdapter, navigateTo, getCurrentProjectIdFromUrl } from '@/engines/_shared/anchoring';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import { t } from '@/i18n/useTranslation';
import { db } from '@/db';
import type { InquiryClaim, InquiryHypothesis } from './types';

const InquiryEngine = lazy(() => import('./components/InquiryEngine'));

const inquiryEngine: EngineDefinition = {
  id: 'inquiry',
  name: 'Investigation',
  description: 'Claims backed by graded sources, what was true when, and competing hypotheses',
  icon: FileSearch,
  category: 'research',
  tables: {
    inquiryCases: 'id, projectId, updatedAt',
    inquiryClaims: 'id, projectId, updatedAt',
    inquiryHypotheses: 'id, projectId, order',
    inquiryRatings: 'id, projectId, hypothesisId, claimId',
    enrichmentRuns: 'id, projectId, entryId, createdAt',
  },
  component: InquiryEngine,
};

registerEngine(inquiryEngine);

function claimPreview(claim: InquiryClaim) {
  return {
    id: claim.id,
    type: 'inquiry-claim',
    engineId: 'inquiry',
    projectId: claim.projectId,
    title: claim.statement.slice(0, 120),
    subtitle: claim.predicate ?? '',
  };
}

function hypothesisPreview(row: InquiryHypothesis) {
  return {
    id: row.id,
    type: 'inquiry-hypothesis',
    engineId: 'inquiry',
    projectId: row.projectId,
    title: row.statement.slice(0, 120),
    subtitle: row.status,
  };
}

registerEntityResolver({
  engineId: 'inquiry',
  entityTypes: ['inquiry-claim', 'inquiry-hypothesis'],
  resolveEntity: async (entityId: string, entityType: string) => {
    if (entityType === 'inquiry-hypothesis') {
      const row = await db.inquiryHypotheses.get(entityId);
      return row ? hypothesisPreview(row) : null;
    }
    const claim = await db.inquiryClaims.get(entityId);
    return claim ? claimPreview(claim) : null;
  },
  searchEntities: async (query: string, projectId?: string) => {
    const q = query.toLocaleLowerCase();
    const claims = projectId ? db.inquiryClaims.where('projectId').equals(projectId) : db.inquiryClaims.toCollection();
    const hypotheses = projectId ? db.inquiryHypotheses.where('projectId').equals(projectId) : db.inquiryHypotheses.toCollection();
    const [claimRows, hypothesisRows] = await Promise.all([
      claims.filter(row => row.statement.toLocaleLowerCase().includes(q)).toArray(),
      hypotheses.filter(row => row.statement.toLocaleLowerCase().includes(q)).toArray(),
    ]);
    return [...claimRows.map(claimPreview), ...hypothesisRows.map(hypothesisPreview)];
  },
});

registerAnchorAdapter({
  engineId: 'inquiry',
  supportsTextRange: false,
  async getEntityTitle(entityId: string) {
    const claim = await db.inquiryClaims.get(entityId);
    if (claim) return claim.statement.slice(0, 120);
    return (await db.inquiryHypotheses.get(entityId))?.statement.slice(0, 120) ?? null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.inquiry'),
  navigateToEntity(entityId: string, projectId?: string) {
    const pid = projectId ?? getCurrentProjectIdFromUrl();
    if (!pid) return;
    navigateTo(`/project/${pid}/inquiry?claim=${encodeURIComponent(entityId)}`);
  },
});

// Backup: plain JSON per table under {projectDir}/inquiry/. Every row is
// scoped by projectId and holds only text, ids and numbers.
registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'inquiry',
  tables: ['inquiryCases', 'inquiryClaims', 'inquiryHypotheses', 'inquiryRatings', 'enrichmentRuns'],
}));

export { inquiryEngine };
