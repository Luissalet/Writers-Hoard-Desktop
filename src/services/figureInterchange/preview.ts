import { FigureImportError, type ParsedFigure } from './index.ts';

export interface DecodedFigure extends Omit<ParsedFigure, 'pngValidation'> {
  pngValidation: 'decoded-pixels';
}

/** Decode before an editor/asset write. Retain original PNG and full source. */
export async function decodeFigurePreview(parsed: ParsedFigure): Promise<DecodedFigure> {
  let bitmap: ImageBitmap | undefined;
  try {
    if (typeof globalThis.createImageBitmap !== 'function') {
      throw new FigureImportError('preview.data', 'PNG pixel decoding requires the browser renderer.');
    }
    bitmap = await globalThis.createImageBitmap(new Blob([new Uint8Array(parsed.png)], { type: 'image/png' }));
    if (bitmap.width !== parsed.width || bitmap.height !== parsed.height) {
      throw new FigureImportError('preview.data', 'Decoded PNG dimensions differ from the capture header.');
    }
    return { ...parsed, pngValidation: 'decoded-pixels' };
  } catch (error) {
    if (error instanceof FigureImportError) throw error;
    throw new FigureImportError('preview.data', 'The PNG capture could not be decoded.');
  } finally {
    bitmap?.close();
  }
}
