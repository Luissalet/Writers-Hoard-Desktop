import {createContext,useContext} from 'react';
import type {ReactNode} from 'react';
import type {LocalAppServices} from './types';
export const LocalAppHostContext=createContext<LocalAppServices|undefined>(undefined);
export const LocalAppChildrenContext=createContext<ReadonlyMap<string,ReactNode>>(new Map());
export function useLocalAppHost(){const value=useContext(LocalAppHostContext);if(!value)throw Error('local_app_host_unavailable');return value;}
