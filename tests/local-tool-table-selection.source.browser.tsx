import {Editor,Mark,Node} from '@tiptap/core';
import {TextSelection} from '@tiptap/pm/state';
import {CellSelection} from '@tiptap/pm/tables';
import {blockNodes} from '@/engines/local/collaborativeRich/blockProsemirror';
import {copySourceCellSelection,restoreSourceCellSelection,sourceCellSelectionEnds,sourceTableCellSelection} from '@/engines/local/collaborativeRich/tableCellSelection';

function assert(condition:unknown,message:string):asserts condition{if(!condition)throw Error(message);}

export async function testSourceTableSelection(){
 const element=document.createElement('div');document.body.append(element);
 const address=(table:string,row:string,column:string)=>JSON.stringify([table,row,column]);
 const textCell=(row:string,column:string)=>{
  if(row==='r1'&&column==='c1')return{type:'paragraph',attrs:{id:'private-paragraph'},content:[{type:'text',text:'Mapa Ω',marks:[{type:'bold'}]}]};
  if(row==='r1'&&column==='c2')return{type:'paragraph',content:[{type:'text',text:'Celda β🙂'}]};
  if(row==='r2'&&column==='c2')return{type:'richImage',attrs:{id:'private-image'}};
  return{type:'paragraph'};
 };
 const cell=(table:string,row:string,column:string,header:boolean)=>({type:header?'tableHeader':'tableCell',attrs:{columnId:column,cellAddress:address(table,row,column)},content:[textCell(row,column)]});
 const row=(table:string,id:string,header=false)=>({type:'tableRow',content:['c1','c2'].map(column=>cell(table,id,column,header))});
 const table=(id:string)=>({type:'table',attrs:{id,columns:['c1','c2']},content:[row(id,'r1',true),row(id,'r2')]});
 const bold=Mark.create({name:'bold',renderHTML(){return['strong',0];}});
 const image=Node.create({name:'richImage',atom:true,addAttributes(){return{id:{default:null,rendered:false}};},renderHTML(){return['figure',{'data-writer-rich-image':''}];}});
 const editor=new Editor({element,extensions:[...blockNodes(new Set(),true,true,false,true,true),bold,image,sourceTableCellSelection],editorProps:{handleDOMEvents:{copy:copySourceCellSelection}},content:{type:'doc',content:[table('t1'),table('t2')]}});
 const {view}=editor,checks:string[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{assert(JSON.stringify(actual)===JSON.stringify(expected),`${label}: ${JSON.stringify(actual)}`);checks.push(label);};
 const domCell=(tableId:string,rowId:string,columnId:string)=>{
  const node=Array.from(view.dom.querySelectorAll('td,th')).find(node=>node.getAttribute('data-writer-cell-address')===address(tableId,rowId,columnId));
  assert(node,'Cell is absent');return node;
 };
 const shiftClick=(node:Element)=>node.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,shiftKey:true}));
 const highlighted=()=>Array.from(view.dom.querySelectorAll('.selectedCell')).map(node=>node.getAttribute('data-writer-cell-address'));
 try {
  const origin=domCell('t1','r1','c1'),target=domCell('t1','r2','c2');
  const originPos=view.posAtDOM(origin.querySelector('p')!,0);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,originPos)));
  const baseline=view.state.doc;
  shiftClick(target);
  assert(view.state.selection instanceof CellSelection,'Expected native cell selection');
  const ends=sourceCellSelectionEnds(view.state.selection);
  equal('Shift-click selects the four cells in row order',highlighted(),[address('t1','r1','c1'),address('t1','r1','c2'),address('t1','r2','c1'),address('t1','r2','c2')]);
  equal('Anchor and head retain their logical addresses',ends,[address('t1','r1','c1'),address('t1','r2','c2')]);
  equal('Selection does not write the document',view.state.doc.eq(baseline),true);
  const clipboard=new DataTransfer(),event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:clipboard});
  view.dom.dispatchEvent(event);
  const html=clipboard.getData('text/html'),copy=new DOMParser().parseFromString(html,'text/html');
  equal('Copy writes both standard formats',[...clipboard.types].sort(),['text/html','text/plain']);
  equal('Plain text retains the Unicode values in row order',clipboard.getData('text/plain').trim(),'Mapa Ω\n\nCelda β🙂');
  equal('HTML retains the rectangle, headers and empty cells',Array.from(copy.querySelectorAll('tr')).map(row=>Array.from(row.cells).map(cell=>[cell.tagName,cell.textContent])),[[['TH','Mapa Ω'],['TH','Celda β🙂']],[['TD',''],['TD','']]]);
  equal('HTML retains text formatting and strips local handles',[copy.querySelector('strong')?.textContent,html.includes('data-writer-'),html.includes('private-'),copy.querySelectorAll('[columns],[columnid],figure,img').length],['Mapa Ω',false,false,0]);
  equal('Copy changes neither document nor range',[view.state.doc.eq(baseline),sourceCellSelectionEnds(view.state.selection)],[true,ends]);
  view.dispatch(view.state.tr.insertText('must stay out'));
  equal('Generic input cannot replace selected cell contents',view.state.doc.eq(baseline),true);
  shiftClick(domCell('t2','r2','c2'));
  equal('A second table cannot become the selection head',sourceCellSelectionEnds(view.state.selection),ends);

  assert(ends,'Selection addresses are absent');
  const rowOnly=editor.schema.nodeFromJSON({type:'doc',content:[{...table('t1'),content:[row('t1','r1',true)]},table('t2')]});
  equal('A removed endpoint returns to a text caret in the surviving cell',restoreSourceCellSelection(rowOnly,ends) instanceof TextSelection,true);
  equal('Both endpoints restore a rectangle after projection',sourceCellSelectionEnds(restoreSourceCellSelection(baseline,ends)!),ends);
  view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  equal('Escape clears the highlight',highlighted(),[]);
  equal('Escape leaves the document unchanged',view.state.doc.eq(baseline),true);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,originPos)));
  shiftClick(target);
  origin.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0}));
  equal('An ordinary click clears an active rectangle',highlighted(),[]);
  equal('An ordinary click leaves the document unchanged',view.state.doc.eq(baseline),true);
  return checks;
 } finally {
  editor.destroy();element.remove();
 }
}
