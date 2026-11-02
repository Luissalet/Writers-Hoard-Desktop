import type {Plugin} from 'vite';
import {createPresenceRelay} from '../electron/presence/server';
/** Dev and packaged expose the same handler on their actual renderer listener. */
export function localToolPresencePlugin():Plugin{return{name:'writer-local-presence',configureServer(server){
 const relay=createPresenceRelay(()=>{const address=server.httpServer?.address();const port=address&&typeof address==='object'?address.port:server.config.server.port??5174;return['127.0.0.1:'+port,'localhost:'+port];});
 server.middlewares.use((req,res,next)=>{void relay.handle(req,res).then(handled=>{if(!handled)next();}).catch(next);});server.httpServer?.once('close',()=>relay.close());
}};}
