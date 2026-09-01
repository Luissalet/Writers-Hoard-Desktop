Set-Location 'C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop'
node _stage/cdp.mjs eval @'
const el = [...document.querySelectorAll("button")].find(b => (b.title||"").startsWith("Leer desde"));
if (!el) return "NOT FOUND";
el.click();
await new Promise(r => setTimeout(r, 1200));
return "clicked; body now: " + document.body.innerText.slice(0, 900);
'@
