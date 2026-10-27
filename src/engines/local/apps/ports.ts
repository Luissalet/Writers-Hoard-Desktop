import type {LocalAppRoute,LocalAppRouteResult} from './types';

export interface MountedLocalApp {
  hostId:string;
  appId:string;
  instanceId:string;
  scope:{projectId:string;eraId?:string};
  readOnly:boolean;
  route:LocalAppRoute;
}
const hosts=new Map<string,MountedLocalApp>();
export function registerLocalAppHost(host:MountedLocalApp):()=>void {
  hosts.set(host.hostId,host);
  return()=>{if(hosts.get(host.hostId)===host)hosts.delete(host.hostId);};
}
export function localAppHosts(projectId:string,eraId:string|undefined,appId:string,instanceId?:string){
  return [...hosts.values()].filter(host=>host.scope.projectId===projectId&&host.scope.eraId===eraId&&host.appId===appId&&(!instanceId||host.instanceId===instanceId)).map(host=>({hostId:host.hostId,appId:host.appId,instanceId:host.instanceId,scope:{...host.scope},readOnly:host.readOnly,route:host.route.get()}));
}
/** A command targets one existing host. Unavailable commands are never queued. */
export async function setLocalAppHostRoute(input:{projectId:string;eraId?:string;appId:string;instanceId:string;hostId:string;path:string;replace?:boolean}):Promise<LocalAppRouteResult>{
  const host=hosts.get(input.hostId);
  if(!host||host.scope.projectId!==input.projectId||host.scope.eraId!==input.eraId||host.appId!==input.appId||host.instanceId!==input.instanceId)return{available:false,applied:false};
  return host.route.set(input.path,{replace:input.replace});
}
