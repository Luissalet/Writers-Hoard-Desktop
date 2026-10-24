import {useMemo,useSyncExternalStore} from 'react';
import {deriveLocalToolLocale,localToolTranslator,prepareLocalToolLocales,type LocalToolLocaleSource} from './locales';
const fallback=Object.freeze({declaration:prepareLocalToolLocales(),getSnapshot:()=> 'en',subscribe:()=>()=>{}});
/** No client/port deliberately means fixed English, not a hidden global-store subscription. */
export function useLocalToolLocale(client?:{readonly locale?:LocalToolLocaleSource}){
 const source=client?.locale??fallback,locale=useSyncExternalStore(source.subscribe,source.getSnapshot,fallback.getSnapshot);
 const prepared=useMemo(()=>prepareLocalToolLocales(source.declaration),[source]);
 return useMemo(()=>deriveLocalToolLocale(prepared,locale),[prepared,locale]);
}
export function useLocalToolT(client?:{readonly locale?:LocalToolLocaleSource}){const snapshot=useLocalToolLocale(client);return useMemo(()=>localToolTranslator(snapshot),[snapshot]);}
