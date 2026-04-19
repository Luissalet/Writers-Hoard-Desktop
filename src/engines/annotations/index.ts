// ============================================
// Annotations engine — registration
// ============================================
//
// Cross-cutting engine #22. Owns two tables (`annotations` +
// `annotationReferences`) and exposes a project-level dashboard. The actual
// authoring UI (margin panel) is mounted *inside* annotatable engines via
// the `<MarginPanel>` component, not on this engine's tab.

import { MessageSquare } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import AnnotationsEngine from './components/AnnotationsEngine';

const annotationsEngine: EngineDefinition = {
  id: 'annotations',
  name: 'Interconnectedness',
  description: 'Margin notes that link writing to characters, seeds, maps, and more.',
  icon: MessageSquare,
  category: 'planning',
  tables: {
    annotations:
      'id, projectId, sourceEngineId, sourceEntityId, isOrphaned, noteType, updatedAt, [sourceEngineId+sourceEntityId]',
    annotationReferences:
      'id, &annotationId, targetEngineId, targetEntityId, [targetEngineId+targetEntityId]',
  },
  component: AnnotationsEngine,
};

registerEngine(annotationsEngine);

registerBackupStrategy(
  makeSimpleBackupStrategy({
    engineId: 'annotations',
    tables: ['annotations', 'annotationReferences'],
  }),
);

export { annotationsEngine };
