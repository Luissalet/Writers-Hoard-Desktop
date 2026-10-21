import '@/engines';
import '@/services/aiBridge/dispatch';
import {prepareRegionalCsvFixture,testRegionalCsv} from './regional-csv.browser';
void(async()=>{const tests=await testRegionalCsv();await prepareRegionalCsvFixture();Object.assign(window,{__transportReady:true,__csvTests:tests});})().catch(error=>Object.assign(window,{__csvFailure:error.stack??String(error)}));
