import {
  declutterLabels,
  nextSemanticTier,
  regionKindVisible,
  semanticTier,
  semanticZoomProfile,
} from '@/engines/worldgen/core/semanticZoom';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function testWorldgenSemanticZoom(): string {
  assert(semanticTier(20000) === 'planetary', 'planetary zoom threshold failed');
  assert(semanticTier(5000) === 'continental', 'continental zoom threshold failed');
  assert(semanticTier(1000) === 'regional', 'regional zoom threshold failed');
  assert(semanticTier(120) === 'local', 'local zoom threshold failed');

  assert(
    nextSemanticTier('continental', 2550) === 'continental',
    'semantic zoom crossed a boundary without hysteresis',
  );
  assert(
    nextSemanticTier('continental', 2100) === 'regional',
    'semantic zoom did not cross after leaving the hysteresis band',
  );
  assert(
    semanticZoomProfile(80).regionalResolution === 640,
    'local tier did not request high-resolution regional data',
  );
  assert(regionKindVisible('village', 'regional'), 'regional tier hid villages');
  assert(!regionKindVisible('farm', 'regional'), 'regional tier exposed local-only farms');
  assert(regionKindVisible('farm', 'local'), 'local tier hid farms');

  const labels = declutterLabels([
    { value: 'capital', x: 0, y: 0, width: 50, priority: 10 },
    { value: 'farm', x: 2, y: 0, width: 40, priority: 1 },
    { value: 'village', x: 80, y: 0, width: 40, priority: 4 },
  ], 3);
  assert(labels.map((label) => label.value).join(',') === 'capital,village',
    'label decluttering did not retain stable higher-priority labels');
  return 'Worldgen semantic zoom and label decluttering';
}
