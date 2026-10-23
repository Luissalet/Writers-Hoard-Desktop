import type { WorldFolderSkipReason } from './types';

/** Plain words for each reason a file produced nothing, in both languages. */
export const SKIP_REASON_LABELS: Record<WorldFolderSkipReason, { es: string; en: string }> = {
  'unsupported-type': { es: 'Tipo de archivo no admitido', en: 'Unsupported file type' },
  empty: { es: 'Vacío', en: 'Empty' },
  'too-large': { es: 'Demasiado grande', en: 'Too large' },
  duplicate: { es: 'Duplicado', en: 'Duplicate' },
  encrypted: { es: 'Cifrado o protegido', en: 'Encrypted or protected' },
  'needs-ocr': { es: 'Imagen escaneada: necesita OCR', en: 'Scanned image: needs OCR' },
  unreadable: { es: 'No se puede leer', en: 'Cannot be read' },
};
export const skipReasonLabel = (reason: WorldFolderSkipReason, es: boolean): string => SKIP_REASON_LABELS[reason][es ? 'es' : 'en'];
