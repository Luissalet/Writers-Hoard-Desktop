// ============================================
// codexTypeMeta — icon + color mappings for Codex entry types
// ============================================
//
// Extracted from `CodexEntryList` and `InspirationGallery` which each carried
// a private copy of the same two lookup tables. Any new surface (lightbox,
// search result row, map pin label, etc.) should import from here so the
// visual language of codex types stays consistent.
//
// Adding a new CodexEntryType: update both maps in this file and every
// consumer will pick up the new mapping automatically.

import { User, MapPin, Sword, Shield, Sparkles, HelpCircle } from 'lucide-react';
import type { CodexEntryType } from '@/types';

export const codexTypeIcons: Record<CodexEntryType, typeof User> = {
  character: User,
  location: MapPin,
  item: Sword,
  faction: Shield,
  concept: Sparkles,
  magic: Sparkles,
  custom: HelpCircle,
};

export const codexTypeColors: Record<CodexEntryType, string> = {
  character: '#c4973b',
  location: '#4a9e6d',
  item: '#4a7ec4',
  faction: '#c4463a',
  concept: '#7c5cbf',
  magic: '#d4a843',
  custom: '#8a8690',
};
