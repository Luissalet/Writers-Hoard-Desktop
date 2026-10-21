import {useLiveQuery} from 'dexie-react-hooks';
import {ArrowUpRight} from 'lucide-react';
import {useTranslation} from '@/i18n/useTranslation';
import {usePaneNavigate} from '@/engines/_shared/usePaneNavigate';
import {getAnchorAdapter} from '@/engines/_shared/anchoring';
import type {WorldEraScope} from '@/services/worldEras/types';
import {workspaceRoute,routeInEra,workspaceRouteKey} from '@/components/project/workspace/routes';
import {annotationEntity} from '../scope';
export default function CommentSourceLink({scope,engineId,entityId}:{scope:WorldEraScope;engineId:string;entityId:string}){const {locale}=useTranslation(),navigate=usePaneNavigate(),source=useLiveQuery(()=>annotationEntity(scope,engineId,entityId),[scope,engineId,entityId]);const open=()=>{const scoped=(path:string)=>navigate(workspaceRouteKey(routeInEra(workspaceRoute(path),scope.eraId)));if(source?.route)scoped(source.route);else getAnchorAdapter(engineId)?.navigateToEntity(entityId,scope.projectId,scoped);};return <button type="button" className="flex min-h-9 max-w-full items-center gap-2 break-words text-left text-xs text-accent-gold focus-visible:outline-2 focus-visible:outline-accent-gold disabled:text-text-muted" disabled={!source} onClick={open}><ArrowUpRight size={14} className="shrink-0"/>{source?.title??(locale==='es'?'Documento no disponible':'Document unavailable')}</button>;}
