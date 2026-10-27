/** Logical paths share the normal workspace query. Decode each segment once. */
export function localAppPath(value:string,subRoutes=true):string {
  if(typeof value!=='string'||/[?#\\]/.test(value)||Array.from(value).some(character=>character.charCodeAt(0)<32))throw Error('local_app_route_invalid');
  const path=value.replace(/^\/+|\/+$/g,'');
  if(!path)return '';
  if(!subRoutes)throw Error('local_app_subroutes_unavailable');
  let segments:string[];
  try{segments=path.split('/').map(segment=>decodeURIComponent(segment));}catch{throw Error('local_app_route_invalid');}
  if(segments.some(segment=>!segment||segment==='.'||segment==='..'))throw Error('local_app_route_invalid');
  return segments.map(segment=>encodeURIComponent(segment)).join('/');
}
export function localAppChildPath(entryId:string){return 'children/'+encodeURIComponent(entryId);}
export function localAppRouteChild(path:string):string|undefined {
  const segments=path.split('/');
  if(segments.length!==2||segments[0]!=='children')return undefined;
  try{return decodeURIComponent(segments[1]);}catch{return undefined;}
}
