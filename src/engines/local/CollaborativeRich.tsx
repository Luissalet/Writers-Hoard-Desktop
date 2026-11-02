import type {ReactNode} from 'react';
import type {AnyExtension} from '@tiptap/core';
import type {LocalToolClient,LocalToolHostContext,LocalToolJson} from './sdk';

/** Explicit flat paragraphs/five-mark component. HTML codec1 keeps its own editor.
 * Extra extensions are fixed for the mount, like the HTML editor. They may add commands,
 * plugins and rules within this profile; they must not add schema or replace author Undo.
 * A new array with the same members is stable. Different members apply on the next mount.
 */
export interface LocalToolCollaborativeRichProps {client:LocalToolClient<LocalToolJson>;context?:LocalToolHostContext;field:string;label?:string;editable?:boolean;placeholder?:string;className?:string;extensions?:AnyExtension[]}
/** Pure public facade: host editor, validator and storage stay outside the author graph. */
export function LocalToolCollaborativeRichEditor<T extends LocalToolJson>({client,context,field,label,editable,placeholder,className,extensions}:{client:LocalToolClient<T>;context?:LocalToolHostContext;field:string;label?:string;editable?:boolean;placeholder?:string;className?:string;extensions?:AnyExtension[]}):ReactNode{
 return context?.renderCollaborativeRich?.({client:client as unknown as LocalToolClient<LocalToolJson>,context,field,label,editable,placeholder,className,extensions})??<p role="status">Collaborative rich editor unavailable in this host.</p>;
}
