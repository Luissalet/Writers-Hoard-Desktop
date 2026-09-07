import {
  makeSimpleBackupStrategy,
  registerBackupStrategy,
} from '@/engines/_shared';

registerBackupStrategy(
  makeSimpleBackupStrategy({
    engineId: 'project-tools',
    tables: [
      'entityLinks',
      'citations',
      'publishingProfiles',
      'conversionReceipts',
      'creativeBranches',
      'creativeBranchDeltas',
      'branchPromotionReceipts',
      'narrativeMoments',
      'storyClaims',
      'sharedCanonEntities',
      'sharedEntityBindings',
    ],
    projectIdFields: {
      sharedCanonEntities: 'seriesId',
    },
  }),
);
