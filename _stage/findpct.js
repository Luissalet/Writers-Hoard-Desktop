const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
location.hash = '#/project/proj_mthy3jeu_q7kvd1/writings';
await sleep(1500);

const hits = [...document.querySelectorAll('*')].filter(
  (el) => el.children.length === 0 && /^\s*0%\s*$/.test(el.textContent || ''),
);
return JSON.stringify(
  hits.slice(0, 4).map((el) => {
    const chain = [];
    let node = el;
    for (let i = 0; i < 5 && node; i += 1) {
      chain.push(node.tagName + '.' + (node.className || '').toString().slice(0, 90));
      node = node.parentElement;
    }
    return {
      text: el.textContent,
      title: el.title || el.getAttribute('aria-label') || null,
      parentText: (el.parentElement?.innerText || '').replace(/\s*\n\s*/g, ' | ').slice(0, 120),
      chain,
    };
  }),
  null,
  2,
);
