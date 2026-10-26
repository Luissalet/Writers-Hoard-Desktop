import defaultCss from './defaultTheme.css?raw';
import {localToolThemeColorTokens,type LocalToolThemeColorToken,type LocalToolThemeSnapshot} from '@/engines/local/themes';
import {workspaceAppearanceStyle} from './style';
import type {WorkspaceAppearanceValues} from './types';

type ResolvedTheme=Pick<LocalToolThemeSnapshot,'mode'|'tokens'>;
let defaults:ResolvedTheme|undefined;
/** This fixed, owned CSS is also imported by index.css; parsing is demand-only. */
function defaultTheme():ResolvedTheme{
 if(defaults)return defaults;
 const tokens={} as Record<LocalToolThemeColorToken,string>;
 for(const key of localToolThemeColorTokens){
  const declarations=[...defaultCss.matchAll(new RegExp(`${key}\\s*:\\s*([^;{}]*);`,'g'))];
  if(declarations.length!==1||!/^#[\da-f]{6}$/i.test(declarations[0][1].trim()))throw Error('workspace_theme_default_invalid: '+key);
  tokens[key]=declarations[0][1].trim();
 }
 const modes=[...defaultCss.matchAll(/color-scheme\s*:\s*([^;{}]*);/g)];
 if(modes.length!==1||!['dark','light'].includes(modes[0][1].trim()))throw Error('workspace_theme_default_mode_invalid');
 defaults=Object.freeze({mode:modes[0][1].trim() as 'light'|'dark',tokens:Object.freeze(tokens)});
 return defaults;
}
/** Resolve exactly the same profile/style cascade used by the workspace. */
export function resolveWorkspaceTheme(values:WorkspaceAppearanceValues):ResolvedTheme{
 const base=defaultTheme(),style=workspaceAppearanceStyle(values),tokens={} as Record<LocalToolThemeColorToken,string>;
 for(const key of localToolThemeColorTokens)tokens[key]=String(style[key]??base.tokens[key]);
 return Object.freeze({mode:style.colorScheme==='light'?'light':style.colorScheme==='dark'?'dark':base.mode,tokens:Object.freeze(tokens)});
}
