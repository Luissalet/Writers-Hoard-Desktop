import './world-authoring-transport.renderer';
import { deleteCodexEntry } from '@/db/operations';
(window as unknown as {__historyDelete:(id:string)=>Promise<void>}).__historyDelete=deleteCodexEntry;
