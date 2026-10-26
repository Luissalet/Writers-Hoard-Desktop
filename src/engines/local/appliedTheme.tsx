import type {CSSProperties,ReactNode} from 'react';
import {LocalToolAppliedThemeContext as AppliedTheme} from './appliedThemeContext';
import {localToolThemeColorTokens,type LocalToolThemeScope} from './themes';

/** Shares the same React commit as the pane's style; it owns no DOM or data read. */
export function LocalToolAppliedThemeProvider({scope,style,children}:{scope:LocalToolThemeScope;style:CSSProperties;children:ReactNode}){
 const colors=style as CSSProperties&Partial<Record<typeof localToolThemeColorTokens[number],string>>;
 const signature=JSON.stringify([scope.projectId,scope.eraId??null,...localToolThemeColorTokens.map(key=>colors[key]??null),style.colorScheme??null]);
 return <AppliedTheme.Provider value={signature}>{children}</AppliedTheme.Provider>;
}
