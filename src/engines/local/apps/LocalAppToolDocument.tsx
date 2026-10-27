import {useContext} from 'react';
import {LocalAppChildrenContext} from './context';
/** An existing membership entry, never a second instance or implicit create. */
export function LocalAppToolDocument({entryId}:{entryId:string}){return useContext(LocalAppChildrenContext).get(entryId)??null;}
