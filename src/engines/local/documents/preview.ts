import {validateSourceToolDocument,type SourceToolDocument} from './types';
import {localToolSemanticPreview} from '../previewTypes';
export {renderLocalToolPreview} from '../previewTypes';
/** Reads an already captured portable row. Never resolves code or a live DB. */
export function sourceDocumentPreview(document:SourceToolDocument,locale:'es'|'en'='en'){validateSourceToolDocument(document);return localToolSemanticPreview(document.title,document.data,document.preview,locale);}
