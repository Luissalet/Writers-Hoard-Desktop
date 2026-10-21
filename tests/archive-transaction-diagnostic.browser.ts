import {db} from '@/db';
import {testDocumentArchive} from './document-archive.browser';
export async function testArchiveTransactionDiagnostic(){
 const original=db.transaction;
 (db as any).transaction=function(...args:any[]){
  const stack=new Error('transaction caller').stack;
  return (original as any).apply(this,args).catch((error:unknown)=>{
   if(String(error).includes('SubTransactionError'))console.error('ARCHIVE_TX_DIAGNOSTIC '+JSON.stringify(args.slice(1,-1).map(value=>Array.isArray(value)?value.map(item=>item.name??item):value?.name??value))+'\n'+stack);
   throw error;
  });
 };
 try{return await testDocumentArchive();}finally{db.transaction=original;}
}
