(async () => {
  return JSON.stringify({
    href: location.href.slice(0, 120),
    hash: location.hash,
    title: document.title,
    bodyStart: (document.body.innerText || '').replace(/\s*\n\s*/g, ' | ').slice(0, 400),
  });
})()
