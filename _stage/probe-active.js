const a = document.activeElement;
return { tag: a.tagName, cls: (a.className || '').toString().slice(0, 80), pin: a.getAttribute && a.getAttribute('data-pin-id'), inPin: !!a.closest('[data-pin-id]'), card: !![...document.querySelectorAll('button')].find(b => b.textContent.includes('Medir desde aquí')) };
