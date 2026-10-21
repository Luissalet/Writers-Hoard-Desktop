import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { localGrain } from './style';
export default function WorkspaceDecoration() { const grain = useMemo(() => localGrain(), []); return <div aria-hidden="true" className="workspace-decoration" style={{ '--workspace-grain': `url("${grain}")` } as CSSProperties} />; }
