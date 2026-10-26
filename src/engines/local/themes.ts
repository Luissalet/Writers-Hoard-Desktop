/** Own readonly color contract; independent of the application and DOM. */
export const localToolThemeColorTokens=Object.freeze([
 '--color-deep','--color-surface','--color-elevated','--color-border','--color-border-hover',
 '--color-text-primary','--color-text-muted','--color-text-dim','--color-accent-gold',
] as const);
export type LocalToolThemeColorToken=typeof localToolThemeColorTokens[number];
export interface LocalToolThemeScope{readonly projectId:string;readonly eraId?:string}
export interface LocalToolThemeSnapshot extends LocalToolThemeScope{
 readonly mode:'light'|'dark';
 readonly tokens:Readonly<Record<LocalToolThemeColorToken,string>>;
}
export interface LocalToolThemeSource{
 get():Promise<LocalToolThemeSnapshot>;
 subscribe(changed:()=>void):()=>void;
}
