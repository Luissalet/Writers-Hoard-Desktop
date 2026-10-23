// Ways into the icon library besides search: categories (characters,
// creatures, items, weapons, magic, places, nature…), genres that favour the
// icons a fantasy, sci-fi, horror, steampunk, modern or historical world
// reaches for, and the icons picked recently on this device.
export interface IconGroup { id: string; es: string; en: string; words: string[] }

export const ICON_CATEGORIES: IconGroup[] = [
  { id: 'characters', es: 'Personajes', en: 'Characters', words: ['user', 'person', 'baby', 'contact', 'smile', 'frown', 'hand', 'footprints', 'accessibility', 'crown', 'glasses', 'venetian', 'drama'] },
  { id: 'creatures', es: 'Criaturas', en: 'Creatures', words: ['bird', 'bug', 'cat', 'dog', 'fish', 'rabbit', 'rat', 'snail', 'squirrel', 'turtle', 'worm', 'egg', 'paw', 'bone', 'skull', 'ghost', 'feather', 'shell', 'origami', 'panda'] },
  { id: 'items', es: 'Objetos', en: 'Items', words: ['key', 'lock', 'box', 'package', 'gem', 'gift', 'bag', 'backpack', 'coins', 'wallet', 'watch', 'lamp', 'candle', 'flask', 'wine', 'beer', 'cup', 'book', 'scroll', 'map', 'compass', 'hourglass', 'anvil', 'hammer', 'pickaxe', 'shovel', 'scissors', 'paintbrush', 'pen', 'feather'] },
  { id: 'weapons', es: 'Armas', en: 'Weapons', words: ['sword', 'swords', 'axe', 'shield', 'crosshair', 'target', 'bomb', 'flame', 'zap', 'slice', 'pickaxe', 'hammer', 'anchor', 'castle', 'bow', 'arrow'] },
  { id: 'magic', es: 'Magia', en: 'Magic', words: ['wand', 'sparkle', 'sparkles', 'star', 'moon', 'sun', 'eclipse', 'orbit', 'flask', 'potion', 'eye', 'scroll', 'gem', 'crystal', 'ghost', 'skull', 'infinity', 'atom', 'aperture', 'flame', 'snowflake', 'zap', 'brain'] },
  { id: 'places', es: 'Lugares', en: 'Places', words: ['castle', 'church', 'landmark', 'building', 'house', 'home', 'hotel', 'school', 'store', 'factory', 'warehouse', 'tent', 'tower', 'lighthouse', 'map', 'pin', 'mountain', 'tree', 'city', 'hospital', 'library', 'university', 'fence', 'door', 'bridge'] },
  { id: 'nature', es: 'Naturaleza', en: 'Nature', words: ['tree', 'trees', 'leaf', 'flower', 'sprout', 'clover', 'cherry', 'grape', 'apple', 'carrot', 'wheat', 'mountain', 'waves', 'droplet', 'cloud', 'sun', 'moon', 'snowflake', 'wind', 'rainbow', 'flame', 'shell', 'palmtree', 'tent', 'volcano'] },
  { id: 'transport', es: 'Viaje', en: 'Travel', words: ['ship', 'sailboat', 'anchor', 'car', 'bus', 'train', 'tram', 'plane', 'rocket', 'bike', 'truck', 'caravan', 'tractor', 'helicopter', 'route', 'compass', 'map', 'signpost', 'milestone', 'footprints'] },
  { id: 'symbols', es: 'Símbolos', en: 'Symbols', words: ['heart', 'star', 'flag', 'badge', 'award', 'trophy', 'medal', 'shield', 'crown', 'circle', 'triangle', 'hexagon', 'diamond', 'infinity', 'ankh', 'cross', 'yin', 'peace', 'swords', 'skull'] },
  { id: 'tech', es: 'Tecnología', en: 'Technology', words: ['cpu', 'bot', 'radio', 'satellite', 'rocket', 'atom', 'battery', 'cable', 'monitor', 'smartphone', 'laptop', 'server', 'wifi', 'radar', 'robot', 'circuit', 'microchip', 'orbit', 'zap', 'cog', 'settings', 'wrench'] },
];

export const ICON_GENRES: IconGroup[] = [
  { id: 'fantasy', es: 'Fantasía', en: 'Fantasy', words: ['castle', 'crown', 'sword', 'swords', 'shield', 'wand', 'sparkles', 'scroll', 'gem', 'dragon', 'ghost', 'skull', 'flask', 'anvil', 'axe', 'tent', 'mountain', 'trees', 'moon', 'star', 'feather', 'key', 'map', 'compass'] },
  { id: 'scifi', es: 'Ciencia ficción', en: 'Sci-fi', words: ['rocket', 'orbit', 'satellite', 'atom', 'bot', 'cpu', 'radar', 'radio', 'zap', 'planet', 'telescope', 'microchip', 'cog', 'battery', 'scan', 'globe', 'infinity', 'aperture', 'fingerprint', 'dna'] },
  { id: 'horror', es: 'Terror', en: 'Horror', words: ['skull', 'ghost', 'bone', 'eye', 'moon', 'candle', 'flame', 'spider', 'bug', 'worm', 'droplet', 'axe', 'knife', 'slice', 'cross', 'church', 'tombstone', 'door', 'lock', 'drama'] },
  { id: 'steampunk', es: 'Steampunk', en: 'Steampunk', words: ['cog', 'cogs', 'settings', 'wrench', 'hammer', 'anvil', 'factory', 'train', 'ship', 'clock', 'watch', 'hourglass', 'gauge', 'flask', 'lamp', 'glasses', 'compass', 'telescope', 'key', 'lock'] },
  { id: 'modern', es: 'Actual', en: 'Modern', words: ['smartphone', 'laptop', 'monitor', 'car', 'bus', 'plane', 'building', 'store', 'coffee', 'credit', 'wallet', 'camera', 'music', 'headphones', 'wifi', 'mail', 'message', 'shopping', 'briefcase', 'hospital'] },
  { id: 'historical', es: 'Histórico', en: 'Historical', words: ['landmark', 'castle', 'church', 'scroll', 'feather', 'book', 'crown', 'sword', 'shield', 'ship', 'anchor', 'wheat', 'candle', 'hourglass', 'map', 'compass', 'coins', 'tent', 'flag', 'axe'] },
];

/** Words in a PascalCase icon name: "SwordsIcon" → ["swords", "icon"]. */
export const iconWords = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/);
export function inGroup(name: string, group: IconGroup): boolean {
  const words = iconWords(name);
  return group.words.some(word => words.includes(word) || (word.length > 4 && words.some(part => part.startsWith(word))));
}

const RECENT_KEY = 'wh.icons.recent';
export function recentIcons(): string[] {
  try { const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 16) : []; } catch { return []; }
}
export function rememberIcon(name: string): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([name, ...recentIcons().filter(item => item !== name)].slice(0, 16))); } catch { /* per-device nicety */ }
}
