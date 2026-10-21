import type {EraDocumentKind} from './types';
/** One identity vocabulary for document cloning and declared local-tool references. */
export const worldDocumentPrefixes:Record<EraDocumentKind,string>={'local-tool':'source-tool','dialog-scene':'scene',codex:'codex',writings:'wr',maps:'map',worldgen:'world',board:'board',timeline:'tl',notes:'note',media:'media',dictionary:'language',tables:'table',genealogy:'tree','character-sheets':'sheet',radar:'radar','model-viewer':'model'};
