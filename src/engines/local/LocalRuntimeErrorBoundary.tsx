import {useId,type ReactNode} from 'react';
import EngineErrorBoundary from '@/components/common/EngineErrorBoundary';
import {useTranslation} from '@/i18n/useTranslation';
import {recordRuntimeError,runtimeErrorIdentity} from './runtimeErrors';

/** The existing fallback/Retry isolates one runtime member, including an app child. */
export default function LocalRuntimeErrorBoundary({namespace,contentHash,children}:{namespace:string;contentHash:string|null|undefined;children:ReactNode}){
 const id=useId(),{t}=useTranslation(),identity=runtimeErrorIdentity(namespace,contentHash);
 if(!identity)return <>{children}</>;
 return <EngineErrorBoundary resetKey={JSON.stringify([namespace,contentHash])} title={t('project.engineError.title')} message={t('project.engineError.message')} retryLabel={t('project.engineError.retry')} detailsLabel={t('project.engineError.details')} onError={error=>recordRuntimeError(identity,'render',error,{mountId:id})}>{children}</EngineErrorBoundary>;
}
