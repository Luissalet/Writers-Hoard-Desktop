const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Libro entero'));
if (b && !document.querySelector('[data-footnote-placement]')) { b.click(); await new Promise(r => setTimeout(r, 2500)); }
const w = document.querySelector('[data-footnote-placement]');
const pm = document.querySelector('.tiptap-editor .ProseMirror');
const h = pm ? pm.querySelectorAll(':scope > .wh-chapter-heading') : null;
const refs = [...document.querySelectorAll('sup.wh-footnote-ref')].map(s => getComputedStyle(s, '::before').content);
const rule = [...document.styleSheets].flatMap(ss => { try { return [...ss.cssRules]; } catch { return []; } }).filter(r => r.cssText.includes('data-footnote-placement')).map(r => r.cssText);
return { attr: w && w.getAttribute('data-footnote-placement'), headings: h && h.length, allHeadings: document.querySelectorAll('.wh-chapter-heading').length, firstHeadingParent: h && h[0] && h[0].parentElement.className.slice(0, 60), refs, rule, hasEditor: !!pm };
