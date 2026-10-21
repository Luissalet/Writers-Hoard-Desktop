import '@/services/aiBridge/dispatch';
import {testWikiProfiles,prepareWikiProfileFixture} from './wiki-profiles.browser';
import {testWikiAppearance,prepareWikiAppearance} from './wiki-appearance.browser';
import {testVoiceReading} from './voice-reading.browser';
void(async()=>{const tests=[...await testWikiProfiles(),...await testWikiAppearance(),...await testVoiceReading()],fixture=await prepareWikiAppearance('wiki-native');Object.assign(window,{__transportReady:true,__wikiTests:tests,__wikiOptions:fixture.options});})().catch(error=>Object.assign(window,{__wikiFailure:error.stack??String(error)}));
