import { buildLanguageFamily, coinName, cognates, etymology, GLOSS_ES } from '../src/engines/worldgen/core/language';
const seed = process.argv[2] || 'monstruo';
const fam = buildLanguageFamily(seed, 6);
console.log(`familia: ${fam.all.length} lenguas, ${fam.living.length} vivas\n`);
console.log('árbol:');
for (const l of fam.all) {
  const ind = '  '.repeat(l.depth + 1);
  console.log(`${ind}${l.name}${l.parent ? '' : '  (reconstruida)'}${l.innovations.length ? '  — ' + l.innovations.slice(0,3).join(', ') : ''}`);
}
console.log('\nel mismo puñado de raíces en cada lengua viva:');
const roots = ['water','stone','high','cold','fort','bear'] as const;
const pad = (s: string, n: number) => s.padEnd(n);
console.log('  ' + pad('', 14) + roots.map(r => pad(GLOSS_ES[r], 11)).join(''));
console.log('  ' + pad('*proto', 14) + roots.map(r => pad('*'+fam.proto.lexicon[r], 11)).join(''));
for (const l of fam.living) console.log('  ' + pad(l.name, 14) + roots.map(r => pad(l.lexicon[r], 11)).join(''));

console.log('\ntopónimos con etimología:');
for (let i = 0; i < 8; i++) {
  const l = fam.living[i % fam.living.length];
  const n = coinName(l, fam.proto, `t${i}`, seed);
  console.log(`  ${pad(n.text, 16)} ${pad('['+l.name+']', 14)} ${etymology(n)}`);
}
console.log('\ncognados de un mismo nombre entre reinos vecinos:');
for (let i = 0; i < 3; i++) {
  const l = fam.living[i];
  const n = coinName(l, fam.proto, `c${i}`, seed);
  const cg = cognates(n, fam, seed, `c${i}`);
  console.log(`  ${n.text} (${l.name}) ${etymology(n)}`);
  console.log(`      ${cg.map(c => `${c.text} [${fam.byId.get(c.langId)!.name}]`).join(' · ')}`);
}
