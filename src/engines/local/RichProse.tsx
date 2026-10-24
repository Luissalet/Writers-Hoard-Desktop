import type {ReactNode} from 'react';
import type {LocalToolClient,LocalToolHostContext,LocalToolJson} from './sdk';

export interface LocalToolRichProseProps {client:LocalToolClient<LocalToolJson>;context?:LocalToolHostContext;field:string;label?:string}
/** Pure public entry: the application supplies the editor for this binding. */
export function LocalToolRichProseEditor<T extends LocalToolJson>({client,context,field,label}:{client:LocalToolClient<T>;context?:LocalToolHostContext;field:string;label?:string}):ReactNode{
 return context?.renderRichProse?.({client:client as unknown as LocalToolClient<LocalToolJson>,context,field,label})??<p role="status">Rich prose editor unavailable in this host.</p>;
}
