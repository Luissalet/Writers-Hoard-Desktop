import { parsePortableFigure, type ParsedFigure } from './index.ts';
import { decodeFigurePreview } from './preview.ts';
import type { LocalToolAssets } from '../../engines/local/assets';
import type { RichImageAsset } from '../../engines/local/convergence/imageFormat';

export const FIGURE_SOURCE_MIME = 'application/vnd.vitruvius.figure+json';
/** The retained source is an ordinary project data file named after its PNG capture. */
export const figureSourceTitle = (pngSha256: string) => `figure-${pngSha256}.vfigure`;

type Assets = Pick<LocalToolAssets, 'import' | 'choices' | 'resolve'>;

export interface ImportedFigure {
  asset: RichImageAsset;
  sourceSha256: string;
  width: number;
  height: number;
  revision: number;
  pageId: string | null;
  stateId: string | null;
  title: string;
}

/** Decode the capture, then store the exact PNG and the complete figure JSON. No document is edited. */
export async function importPortableFigure(assets: Assets, input: unknown): Promise<ImportedFigure> {
  const parsed: ParsedFigure = parsePortableFigure(input);
  await decodeFigurePreview(parsed);
  const image = await assets.import(new File([new Uint8Array(parsed.png)], 'figure.png', { type: 'image/png' }), 'image');
  const source = await assets.import(
    new File([parsed.sourceJson], figureSourceTitle(image.sha256), { type: FIGURE_SOURCE_MIME }), 'data');
  const { figure } = parsed;
  return {
    asset: { sha256: image.sha256, mime: 'image/png', size: image.size },
    sourceSha256: source.sha256,
    width: parsed.width,
    height: parsed.height,
    revision: figure.revision,
    pageId: figure.page_id ?? null,
    stateId: figure.state_id ?? null,
    title: figure.title ?? '',
  };
}

/** Return the retained figure JSON for an image descriptor, or null for an ordinary image. */
export async function findFigureSource(assets: Assets, asset: Pick<RichImageAsset, 'sha256'>): Promise<string | null> {
  const title = figureSourceTitle(asset.sha256);
  const entry = (await assets.choices('data')).find(choice => choice.title === title);
  if (!entry) return null;
  const file = await assets.resolve(entry.ref);
  return file ? await file.blob.text() : null;
}
