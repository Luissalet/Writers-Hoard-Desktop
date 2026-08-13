const r = require('./lint.json');
let e = 0, w = 0;
const out = [];
for (const f of r) {
  if (!f.messages.length) continue;
  for (const m of f.messages) {
    if (m.severity === 2) e++; else w++;
    const rel = f.filePath.split('Writers hoard desktop').pop();
    out.push(rel + ':' + m.line + ' [' + (m.severity === 2 ? 'ERR' : 'warn') + '] ' + m.ruleId + ' -- ' + m.message);
  }
}
console.log('ERRORS=' + e + ' WARNINGS=' + w);
console.log(out.slice(0, 60).join('\n'));
