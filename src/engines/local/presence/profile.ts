import {getSetting,setSetting} from '@/db/operations';
import type {LocalToolPresenceProfile} from './types';
const key='writer.presence.profiles';
export async function readLocalPresenceProfiles():Promise<{profiles:LocalToolPresenceProfile[];selected:string|null}>{const raw=await getSetting(key);if(!raw)return{profiles:[],selected:null};const value=JSON.parse(raw);if(!Array.isArray(value.profiles))throw Error('presence_profiles_invalid');return value;}
/** Only an explicit profile choice writes preferences. Hook/host construction never calls this. */
export async function chooseLocalPresenceProfile(profile:LocalToolPresenceProfile){if(!profile.userId||!profile.name.trim()||!profile.color)throw Error('presence_profile_missing');const old=await readLocalPresenceProfiles(),selected={...profile,name:profile.name.trim()},exists=old.profiles.some(p=>p.userId===profile.userId),next={profiles:exists?old.profiles.map(p=>p.userId===profile.userId?selected:p):[...old.profiles,selected],selected:profile.userId};if(JSON.stringify(next)!==JSON.stringify(old))await setSetting(key,JSON.stringify(next));return selected;}
export function presenceRoomFromUrl(value:string){const url=new URL(value,window.location.origin);if(url.origin!==window.location.origin)throw Error('presence_other_host');return url.searchParams.get('presenceSession')??'';}
export function currentPresenceInvite(){const url=new URL(window.location.href);return url.searchParams.get('presenceSession')??(url.hash.includes('?')?new URLSearchParams(url.hash.slice(url.hash.indexOf('?')+1)).get('presenceSession'):null)??'';}
