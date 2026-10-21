import {lazy,Suspense,useState,type ComponentProps} from 'react';

const ModalBody=lazy(()=>import('./ModalBody'));
type ModalProps=ComponentProps<typeof import('./ModalBody').default>;

/** Closed dialogs do not load their renderer, motion code or focus machinery. */
export default function Modal(props:ModalProps){
  const [requested,setRequested]=useState(props.open);
  if(props.open&&!requested)setRequested(true);
  return requested?<Suspense fallback={null}><ModalBody {...props}/></Suspense>:null;
}
