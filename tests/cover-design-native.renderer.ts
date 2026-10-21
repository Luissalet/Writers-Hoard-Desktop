import '@/services/aiBridge/dispatch';
import {testCoverDesign,prepareCoverFixture,coverFixture} from './cover-design.browser';
void(async()=>{const tests=await testCoverDesign(),fixture=await prepareCoverFixture();Object.assign(window,{__transportReady:true,__coverTests:tests,__cover:coverFixture(),__writingId:fixture.writing.id});})().catch(error=>Object.assign(window,{__coverFailure:error.stack??String(error)}));
