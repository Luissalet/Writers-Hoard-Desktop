const refs = [...document.querySelectorAll('sup.wh-footnote-ref')];
refs[2].scrollIntoView({ block: 'center' });
await new Promise(r => setTimeout(r, 800));
return refs.map(r => { const b = r.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y)]; });
