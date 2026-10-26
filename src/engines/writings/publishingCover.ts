import type { ReaderPresentation } from './readerPresentationTypes';
import { safeReaderPresentation } from './readerPresentation';
import { exportCoverImage } from './coverDesign/export';
import type { PublishingCover } from './publishingDocument';

export interface PublishingCoverSource {
  title: string;
  coverImage?: string;
  readerPresentation?: ReaderPresentation;
}

/** Copy effective manuscript/era inputs before the first await; never read the DB. */
export async function capturePublishingCover(project: PublishingCoverSource): Promise<PublishingCover> {
  const title = project.title;
  const artwork = project.coverImage;
  const cover = structuredClone(safeReaderPresentation(project.readerPresentation).cover);
  const image = await exportCoverImage(title, artwork, cover, 'front', 'png', 2);
  if (image.width !== 1200 || image.height !== 1800 || !/^data:image\/png;base64,[a-z\d+/=]+$/i.test(image.dataUrl)) throw Error('publishing_cover_render_failed');
  return Object.freeze({ src: image.dataUrl, width: 1200, height: 1800, alt: title });
}
