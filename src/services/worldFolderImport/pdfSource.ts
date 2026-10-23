import { ManuscriptImportError } from '@/engines/writings/manuscriptImport';
import type { WorldFolderSkipReason } from './types';

export type PdfSource = { text: string; pages: number } | { skip: WorldFolderSkipReason; code: string; message: string };

/** A PDF's text layer as Markdown, or the plain reason it cannot be imported. */
export async function readPdfSource(bytes: Uint8Array, stem: string): Promise<PdfSource> {
  try {
    const { parsePdfBlocks, pdfBlocksToMarkdown } = await import('@/engines/writings/manuscriptPdf');
    const result = await parsePdfBlocks(bytes);
    if (!result.blocks.length) return { skip: 'empty', code: 'empty_file', message: 'El PDF no contiene texto importable. / The PDF has no importable text.' };
    return { text: pdfBlocksToMarkdown(result.blocks, stem), pages: result.pages };
  } catch (error) {
    if (error instanceof ManuscriptImportError) {
      if (error.code === 'scanned-pdf') return { skip: 'needs-ocr', code: 'pdf_needs_ocr', message: 'Este PDF es una imagen escaneada: necesita OCR. / This PDF is a scanned image: it needs OCR.' };
      if (error.code === 'protected') return { skip: 'encrypted', code: 'pdf_encrypted', message: 'Este PDF está protegido con contraseña. / This PDF is password-protected.' };
      return { skip: 'unreadable', code: 'pdf_unreadable', message: 'No se ha podido leer este PDF. / This PDF could not be read.' };
    }
    throw error;
  }
}
