import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { localGrain } from './style';
import { useAppStore } from '@/stores/appStore';
import type { WorkspaceAppearanceValues } from './types';

/** Decorative only: no timers, randomness, hit targets or document writes. */
export default function WorkspaceDecoration({ values = {} }: { values?: WorkspaceAppearanceValues }) {
  const grain = useMemo(() => localGrain(), []);
  const reduceMotion = useAppStore(state => state.motion === 'reduce');
  const effect = values.effect ?? 'none';
  const count = values.performance || reduceMotion || effect === 'none' ? 0 : Math.round((values.effectIntensity ?? 35) * .4);
  return <div aria-hidden="true" className="workspace-decoration" style={{ '--workspace-grain': `url("${grain}")` } as CSSProperties}>
    {count > 0 && <div className="workspace-particles" data-effect={effect}>
      {Array.from({ length: count }, (_, index) => <i key={index} style={{
        left: `${(index * 37.7) % 100}%`, top: `${(index * 23.3) % 100}%`,
        animationDelay: `${-(index * 1.7)}s`, animationDuration: `${8 + index % 9}s`,
      }} />)}
    </div>}
  </div>;
}
