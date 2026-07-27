import {
  makeSimpleBackupStrategy,
  registerBackupStrategy,
} from '@/engines/_shared';

registerBackupStrategy(
  makeSimpleBackupStrategy({
    engineId: 'project-tools',
    tables: ['entityLinks', 'citations', 'publishingProfiles', 'conversionReceipts'],
  }),
);
