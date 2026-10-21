import {testRegionalCsv,testRegionalCsvRegressions} from './regional-csv.browser';
import {testTimelineRich} from './timeline-rich.browser';
import {testTimelineScopes} from './timeline-scopes.browser';
export async function testWorldFolderImportRegressions(){const out:string[]=[];for(const [label,run] of [['regional-csv',testRegionalCsv],['tables-calculations',testRegionalCsvRegressions],['timeline-rich',testTimelineRich],['timeline-scopes',testTimelineScopes]] as const)for(const item of await run())out.push(`${label}: ${item}`);return out;}
