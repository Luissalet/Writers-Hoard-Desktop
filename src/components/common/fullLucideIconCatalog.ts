import { icons, type LucideIcon } from 'lucide-react';

export type ProjectIconCatalog = Record<string, LucideIcon>;

// This module must remain behind a dynamic import. Importing Lucide's `icons`
// namespace from an eagerly loaded component pulls the complete icon library
// into the renderer entry.
export const fullLucideIconCatalog = icons as ProjectIconCatalog;
