import type {ReactNode} from 'react';
import type {AnyExtension} from '@tiptap/core';
import type {LocalToolClient,LocalToolHostContext,LocalToolJson} from './sdk';

/** Extra extensions stay stable for the editor mount and use the existing rich HTML profile. */
export interface LocalToolRichProseProps {client:LocalToolClient<LocalToolJson>;context?:LocalToolHostContext;field:string;label?:string;extensions?:AnyExtension[]}
/** Pure public entry: the application supplies the editor for this binding. */
export function LocalToolRichProseEditor<T extends LocalToolJson>({client,context,field,label,extensions}:{client:LocalToolClient<T>;context?:LocalToolHostContext;field:string;label?:string;extensions?:AnyExtension[]}):ReactNode{
 return context?.renderRichProse?.({client:client as unknown as LocalToolClient<LocalToolJson>,context,field,label,extensions})??<p role="status">Rich prose editor unavailable in this host.</p>;
}
