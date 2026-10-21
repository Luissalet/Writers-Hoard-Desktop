import type {WorldWikiOptions} from '@/types/worldWiki';
export interface WikiEdition{id:string;publishedAt:number;profileName:string;options:WorldWikiOptions;sourceFingerprint:string;reader:{html:string;filename:string;sha256:string;counts:{entries:number;maps:number}}}
export interface WikiProfile{id:string;name:string;revision:number;createdAt:number;updatedAt:number;options:WorldWikiOptions;editions?:WikiEdition[]}
export interface WikiProfilesProject{id?:string;wikiProfiles?:WikiProfile[]}
