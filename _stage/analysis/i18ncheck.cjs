const fs = require('fs');
const path = require('path');
const sets = {};
for (const l of ['en', 'es']) {
  const s = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'locales', l + '.ts'), 'utf8');
  const keys = [...s.matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1]);
  const dup = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  console.log(l + ': ' + keys.length + ' keys, dups: ' + JSON.stringify(dup));
  sets[l] = new Set(keys);
}
console.log('missing in es: ' + JSON.stringify([...sets.en].filter((k) => !sets.es.has(k))));
console.log('missing in en: ' + JSON.stringify([...sets.es].filter((k) => !sets.en.has(k))));
