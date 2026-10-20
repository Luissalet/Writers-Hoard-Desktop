import { createContext,useContext,useEffect } from 'react';
export type EmbeddedCloseGuard=()=>boolean|Promise<boolean>;
export const EmbeddedToolCloseContext=createContext<((guard:EmbeddedCloseGuard)=>()=>void)|null>(null);
export const ToolDocumentDepth=createContext(0);
export const useToolDocumentDepth=()=>useContext(ToolDocumentDepth);
/** Optional embedded scope. Normal standalone tools retain their existing flow. */
export function useEmbeddedToolCloseGuard(guard:EmbeddedCloseGuard) {
  const register=useContext(EmbeddedToolCloseContext);
  useEffect(()=>register?.(guard),[guard,register]);
}
