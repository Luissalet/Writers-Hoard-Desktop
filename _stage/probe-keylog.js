window.__keys = [];
window.addEventListener('keydown', (e) => window.__keys.push(e.key + '@' + e.target.tagName + (e.target.getAttribute && e.target.getAttribute('data-pin-id') ? '#pin' : '')), true);
return 'listening';
