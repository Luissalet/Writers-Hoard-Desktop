import { lazy } from 'react';

// ============================================
// Beta reading — engine registration
// ============================================
//
// Sends chosen chapters to readers as one self-contained HTML page and brings
// their comments back, anchored to a quote rather than an offset. The logic
// lives in src/services/betaReading; this engine is the screen over it.

import { BookOpenCheck } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';

const BetaReadingEngine = lazy(() => import('./components/BetaReadingEngine'));

const betaReadingEngine: EngineDefinition = {
  id: 'beta-reading',
  name: 'Beta reading',
  description: 'Send chapters to beta readers as one file and bring their comments back, anchored to the text',
  icon: BookOpenCheck,
  category: 'core',
  tables: {
    betaPackages: 'id, projectId, version, createdAt',
    betaResponses: 'id, projectId, packageId, reader',
    betaComments: 'id, projectId, writingId, packageId, responseId, createdAt',
  },
  component: BetaReadingEngine,
};

registerEngine(betaReadingEngine);

// Backup: plain JSON per table under {projectDir}/beta-reading/. Every row is
// scoped by projectId and holds only text, ids and numbers.
registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'beta-reading',
  tables: ['betaPackages', 'betaResponses', 'betaComments'],
}));

export { betaReadingEngine };
