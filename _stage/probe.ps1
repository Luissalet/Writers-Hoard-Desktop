Set-Location 'C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop'
node _stage/cdp.mjs eval @'
return [...document.querySelectorAll('button')].map((b,i) => ({
  i, t: (b.innerText||'').trim().slice(0,28), title: b.title || null, aria: b.getAttribute('aria-label')
})).filter(b => b.t || b.title || b.aria).slice(0, 45);
'@
