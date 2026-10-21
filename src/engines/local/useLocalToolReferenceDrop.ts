import {useState,type DragEvent} from 'react';
import {LOCAL_TOOL_DOCUMENT_MIME} from './references';
import type {LocalToolDocumentReference} from './stateCodec';
import type {LocalToolClient} from './sdk';
import type {LocalToolJson} from './stateTypes';
export function useLocalToolReferenceDrop<T extends LocalToolJson>(client:LocalToolClient<T>,onReference:(reference:LocalToolDocumentReference)=>Promise<unknown>|void){const [error,setError]=useState(''),[busy,setBusy]=useState(false);return{error,busy,dropProps:{onDragOver:(event:DragEvent)=>{if(event.dataTransfer.types.includes(LOCAL_TOOL_DOCUMENT_MIME)){event.preventDefault();event.dataTransfer.dropEffect='copy';}},onDrop:(event:DragEvent)=>{const text=event.dataTransfer.getData(LOCAL_TOOL_DOCUMENT_MIME);if(!text)return;event.preventDefault();setError('');setBusy(true);void client.refs.acceptDrag(text).then(result=>onReference(result.reference)).catch(reason=>setError(String(reason))).finally(()=>setBusy(false));}}};}
