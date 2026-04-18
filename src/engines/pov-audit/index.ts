// ============================================
// POV / Scene Audit — engine registration
// ============================================
//
// Zero-storage engine: owns no tables. Registered for its component only —
// surfaces an "Audit" tab that rolls up character usage across the dialog /
// scene / codex data other engines own.

import { Eye } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine } from '@/engines/_registry';
import PovAuditEngine from './components/PovAuditEngine';

const povAuditEngine: EngineDefinition = {
  id: 'pov-audit',
  name: 'POV Audit',
  description: 'Ranks character screen time and flags imbalance across scenes',
  icon: Eye,
  category: 'planning',
  // No tables — purely derived view.
  tables: {},
  component: PovAuditEngine,
};

registerEngine(povAuditEngine);

export { povAuditEngine };
