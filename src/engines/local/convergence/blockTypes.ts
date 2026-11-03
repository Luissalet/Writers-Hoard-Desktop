import type {LocalToolJson} from '../stateTypes';
import type {RichBlockCapture,RichBlockMoveCapture} from './blockFormat';
export * from './blockFormat';
export type RichBlockAction=import('./blockText').RichBlockTextAction|RichBlockCoreAction|import('./blockEditingTypes').RichBlockEditingAction|import('./blockExit').RichBlockExitAction;
export type RichBlockCoreAction=
 |{type:'rich-block-wrap';field:string;capture:RichBlockCapture;wrapper:{id:string;type:'bullet-list'|'ordered-list';attrs:Record<string,LocalToolJson>};items:{id:string;leafId:string}[]}
 |{type:'rich-block-move';field:string;capture:RichBlockMoveCapture};
