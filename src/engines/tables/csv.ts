export type CsvDelimiter=','|';'|'\t';
export type CsvEncoding='auto'|'utf-8'|'utf-16le'|'utf-16be'|'windows-1252'|'gb18030';
export interface CsvOptions{delimiter?:CsvDelimiter|'auto';decimal?:'.'|',';columnKinds?:('text'|'number')[];mode?:'table'|'sheet'}
export interface CsvExportOptions{delimiter?:CsvDelimiter;decimal?:'.'|',';encoding?:'utf-8'|'utf-16le'|'windows-1252'}
export function csvDelimiter(value:unknown,auto=false):CsvDelimiter|'auto'{if(value===undefined)return auto?'auto':',';if(value===','||value===';'||value==='\t'||auto&&value==='auto')return value;throw Error('csv_delimiter_invalid');}
export function csvEncoding(value:unknown):CsvEncoding{if(value===undefined)return'auto';if(['auto','utf-8','utf-16le','utf-16be','windows-1252','gb18030'].includes(String(value)))return value as CsvEncoding;throw Error('csv_encoding_invalid');}
export function decodeCsv(bytes:Uint8Array,encoding:CsvEncoding='auto'):{text:string;encoding:Exclude<CsvEncoding,'auto'>}{
 let chosen:Exclude<CsvEncoding,'auto'>=encoding==='auto'?'utf-8':encoding;
 if(encoding==='auto'){if(bytes[0]===0xff&&bytes[1]===0xfe)chosen='utf-16le';else if(bytes[0]===0xfe&&bytes[1]===0xff)chosen='utf-16be';}
 try{return{text:new TextDecoder(chosen,{fatal:true}).decode(bytes),encoding:chosen};}catch{throw Error(encoding==='auto'?'csv_encoding_selection_required':'csv_encoding_decode_failed');}
}
/** Count separators only outside quoted fields; full parser still validates each record. */
export function detectCsvDelimiter(source:string):CsvDelimiter{
 const candidates:CsvDelimiter[]=[',',';','\t'],counts:number[][]=[],row=[0,0,0];let quoted=false,nonempty=false;
 for(let i=0;i<source.length;i++){const char=source[i];if(char==='"'){if(quoted&&source[i+1]==='"'){i++;continue;}quoted=!quoted;nonempty=true;}else if(!quoted&&(char==='\r'||char==='\n')){if(nonempty)counts.push([...row]);row.fill(0);nonempty=false;if(char==='\r'&&source[i+1]==='\n')i++;}else{nonempty=true;if(!quoted){const index=candidates.indexOf(char as CsvDelimiter);if(index>=0)row[index]++;}}}
 if(nonempty)counts.push(row);
 const plausible=candidates.filter((_,index)=>counts.length>0&&counts[0][index]>0&&counts.every(row=>row[index]===counts[0][index]));
 if(plausible.length===1)return plausible[0];
 // One-column files without any separators are valid. Competing separators need a choice.
 if(counts.every(row=>row.every(value=>value===0)))return',';
 throw Error('csv_delimiter_selection_required');
}
export function csvNumeric(value:string,decimal:'.'|',',delimiter:CsvDelimiter):string{
 if(!value)return value;if(decimal===','&&delimiter===',')throw Error('csv_decimal_delimiter_conflict');
 const normalized=decimal===','?value.replace(',','.'):value;
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)||!Number.isFinite(Number(normalized))||Math.abs(Number(normalized))>Number.MAX_SAFE_INTEGER)throw Error('csv_number_invalid');
 return normalized;
}
/** UTF16 and legacy export are bytes, never a mislabeled UTF8 Blob. */
export function encodeCsv(text:string,encoding:CsvExportOptions['encoding']='utf-8'):Uint8Array{
 if(encoding==='utf-8')return new TextEncoder().encode(text);
 const source=text.replace(/^\ufeff/,'');
 if(encoding==='utf-16le'){const out=new Uint8Array(2+source.length*2);out[0]=255;out[1]=254;for(let i=0;i<source.length;i++){const code=source.charCodeAt(i);out[2+i*2]=code&255;out[3+i*2]=code>>>8;}return out;}
 if(encoding!=='windows-1252')throw Error('csv_encoding_invalid');
 const decoder=new TextDecoder('windows-1252'),map=new Map<string,number>();for(let i=0;i<256;i++)map.set(decoder.decode(Uint8Array.of(i)),i);
 const out:number[]=[];for(const char of source){const value=map.get(char);if(value===undefined)throw Error('csv_encoding_unrepresentable');out.push(value);}return Uint8Array.from(out);
}
