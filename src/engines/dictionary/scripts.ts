/** Editable visual substitutions, not linguistic transliterations. Unicode letters
 * are referenced from the Unicode Tifinagh, Ogham, Runic and Glagolitic charts. */
export const scriptPresets = [
  { id: 'tifinagh', name: 'Tifinagh', glyphs: 'ⴰⴱⵛⴷⴻⴼⴳⵀⵉⵊⴽⵍⵎⵏⵓⵒⵇⵔⵙⵜⵓⵠⵡⵅⵢⵣ' },
  { id: 'ogham', name: 'Ogham', glyphs: 'ᚐᚁᚉᚇᚓᚃᚌᚆᚔᚔᚊᚂᚋᚅᚑᚚᚊᚏᚄᚈᚒᚃᚃᚕᚔᚎ' },
  { id: 'runic', name: 'Runes · Elder Futhark', glyphs: 'ᚨᛒᚲᛞᛖᚠᚷᚺᛁᛃᚲᛚᛗᚾᛟᛈᚲᚱᛊᛏᚢᚹᚹᛉᛇᛉ' },
  { id: 'glagolitic', name: 'Glagolitic', glyphs: 'ⰀⰁⰜⰄⰅⰗⰃⰘⰋⰊⰍⰎⰏⰐⰑⰒⰍⰓⰔⰕⰖⰂⰂⰝⰟⰈ' },
] as const;

export function presetMapping(id: string): string | undefined {
  const preset = scriptPresets.find(item => item.id === id);
  if (!preset) return undefined;
  return [...'abcdefghijklmnopqrstuvwxyz'].map((letter, index) => `${letter}=${[...preset.glyphs][index]}`).join('\n');
}
