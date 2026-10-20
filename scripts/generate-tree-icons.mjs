// Persist the selected installed Lucide paths as pure data for network-free SVG.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = ['Heart', 'Sword', 'Shield', 'Skull', 'Star', 'Crown', 'Link', 'Handshake', 'Flame', 'Gem', 'Anchor', 'Eye'];
const icons = {};
for (const name of names) {
  const slug = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  const module = await import(pathToFileURL(path.join(root, 'node_modules/lucide-react/dist/esm/icons', slug + '.js')).href);
  icons[name] = module.__iconNode.map(([tag, attrs]) => [tag, Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'key'))]);
}
await fs.writeFile(path.join(root, 'src/engines/genealogy/relationIconData.ts'), '/** Generated from the installed lucide-react icon data (ISC license).\n * See node_modules/lucide-react/LICENSE. Regenerate: node scripts/generate-tree-icons.mjs\n * These names are also rendered by the existing ProjectIcon catalog. */\nexport const RELATION_ICON_DATA: Record<string, ReadonlyArray<readonly [string, Readonly<Record<string, string | number>>]>> = ' + JSON.stringify(icons, null, 2) + ';\n', 'utf8');
console.log('Generated ' + names.length + ' local relationship icons');
