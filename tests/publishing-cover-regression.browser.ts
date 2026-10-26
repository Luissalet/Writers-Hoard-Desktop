import {testPublishingCoverIntegratedGap} from './publishing-cover-capture.browser';
import {testPublishingCoverUi} from './publishing-cover-ui.browser';
import {testPublishingFrontMatter} from './publishing-front-matter.browser';
import {testPublishingReview} from './publishing-review.browser';
import {testPublishingBookStyle} from './publishing-book-style.browser';
import {testPublishingChapterImages} from './publishing-chapter-images.browser';
import {testPublishingInlineImages} from './publishing-inline-images.browser';
import {testPublishingSourcebook} from './publishing-sourcebook.browser';

/** Same shipping browser runner; no stage imports, service restarts or output stubs. */
export async function testPublishingCoverRegression(){
 const results:string[]=[];
 for(const test of [testPublishingCoverIntegratedGap,testPublishingCoverUi,testPublishingFrontMatter,testPublishingReview,testPublishingBookStyle,testPublishingChapterImages,testPublishingInlineImages,testPublishingSourcebook])results.push(...await test());
 return results;
}
