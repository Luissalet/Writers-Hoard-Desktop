// ============================================================================
// Copilot — backup strategy for the conversation tables
// ============================================================================
//
// Engineless tables, like the project-tools set: registered here and imported
// from engines/index.ts so the coverage guardrail sees them. Exports rows
// verbatim — messages are text and small tool cards, nothing binary.

import { makeSimpleBackupStrategy, registerBackupStrategy } from '@/engines/_shared';

export const AI_ASSISTANT_TABLES = ['aiThreads', 'aiMessages', 'aiProjectSettings'] as const;

registerBackupStrategy(
  makeSimpleBackupStrategy({
    engineId: 'ai-assistant',
    tables: [...AI_ASSISTANT_TABLES],
  }),
);
