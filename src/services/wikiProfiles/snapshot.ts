import type {Transaction} from 'dexie';
import {db} from '@/db';
import type {InspirationImage} from '@/types';
import type {WorldEraScope} from '@/services/worldEras/types';
import {capturePublicationSources,publicationReaderSource,publicationSourceFingerprint,type PublicationSnapshot} from '@/services/publishedEditions/snapshot';
export interface WikiSourceSnapshot{publication:PublicationSnapshot;images:InspirationImage[]}
export async function captureWikiSources(tx:Transaction,scope:WorldEraScope):Promise<WikiSourceSnapshot>{const publication=await capturePublicationSources(tx,scope),images=await tx.table('inspirationImages').where('projectId').equals(scope.projectId).toArray()as InspirationImage[];return{publication,images};}
export function captureWikiSnapshot(scope:WorldEraScope){return db.transaction('r',db.tables,tx=>captureWikiSources(tx,scope));}
export function wikiSource(snapshot:WikiSourceSnapshot){return{...publicationReaderSource(snapshot.publication),images:structuredClone(snapshot.images)};}
export function wikiSourceFingerprint(snapshot:WikiSourceSnapshot){const project={...snapshot.publication.project};Reflect.deleteProperty(project,'wikiProfiles');Reflect.deleteProperty(project,'updatedAt');return publicationSourceFingerprint({...snapshot.publication,project,tables:{...snapshot.publication.tables,_wikiImages:snapshot.images as unknown as PublicationSnapshot['tables'][string]}});}
