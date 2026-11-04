import type {LocalToolConvergenceIdentity} from '@/engines/local/convergence/types';
import type {RichBlockBinding,RichBlockKind,RichBlockPlacement} from '@/engines/local/convergence/blockTypes';
import type {RichMark} from '@/engines/local/convergence/richTypes';
import type {LocalToolJson} from '@/engines/local/stateTypes';

export interface RichBlockEditCapture {
 format:'writers-hoard-block-edit/1';identity:LocalToolConvergenceIdentity;field:string;
 nodeIds:string[];bindings:RichBlockBinding[];frontier:string[];destination?:RichBlockPlacement;
}
export type RichBlockEditingAction=import('./tableEditing').RichTableInsertAction|import('./tableAxesEditing').RichTableCreateAction
 |{type:'rich-table-row-header';field:string;capture:RichBlockEditCapture;header:boolean}
 |{type:'rich-image-insert';field:string;capture:RichBlockEditCapture;id:string;asset:import('./imageFormat').RichImageAsset}
 |{type:'rich-block-list-indent';field:string;capture:RichBlockEditCapture;direction:'in'|'out';listId?:string}
 |{type:'rich-block-insert';field:string;capture:RichBlockEditCapture;block:{id:string;type:'paragraph'|'heading';attrs:Record<string,LocalToolJson>};text:string;marks?:RichMark[];link?:{href:string}}
 |{type:'rich-block-transform';field:string;capture:RichBlockEditCapture;kind:RichBlockKind;attrs:Record<string,LocalToolJson>}
 |{type:'rich-block-container';field:string;capture:RichBlockEditCapture;container:{id:string;type:'blockquote'|'toggle';attrs:Record<string,LocalToolJson>}}
 |{type:'rich-block-hide';field:string;capture:RichBlockEditCapture}
 |{type:'rich-block-unwrap';field:string;capture:RichBlockEditCapture};
