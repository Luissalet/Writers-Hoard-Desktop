// Drive the running dev renderer over the Chrome DevTools Protocol.
//   node _stage/cdp.mjs eval "document.title"
//   node _stage/cdp.mjs text "h1"
//   node _stage/cdp.mjs click "button[title='Leer']"
//   node _stage/cdp.mjs route "#/project/abc/writings"
//   node _stage/cdp.mjs shot out.png
// Node 24 has a global WebSocket, so this needs no dependency.
const PORT = process.env.CDP_PORT || 9222;

async function pickTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && !/devtools:/.test(t.url) && !/quick-note/.test(t.url));
  if (!page) throw new Error(`no page target (saw: ${targets.map((t) => t.type + ' ' + t.url).join(', ')})`);
  return page;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', (e) => reject(new Error('ws error ' + (e.message || ''))), { once: true });
  });
}

function send(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await send(ws, Date.now() % 100000, 'Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

const EXPRESSIONS = {
  eval: (arg) => arg,
  text: (sel) => `const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.innerText.slice(0, 4000) : null;`,
  count: (sel) => `return document.querySelectorAll(${JSON.stringify(sel)}).length;`,
  click: (sel) => `const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NOT FOUND'; el.click(); await new Promise(r => setTimeout(r, 400)); return 'clicked';`,
  byText: (needle) => `
    const wanted = ${JSON.stringify(needle)}.toLowerCase();
    const hits = [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')]
      .filter(el => (el.innerText || el.getAttribute('aria-label') || el.title || '').toLowerCase().includes(wanted));
    return hits.slice(0, 12).map(el => ({ tag: el.tagName, text: (el.innerText || '').trim().slice(0, 80), aria: el.getAttribute('aria-label'), title: el.title }));`,
  clickText: (needle) => `
    const wanted = ${JSON.stringify(needle)}.toLowerCase();
    const el = [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')]
      .find(e => (e.innerText || e.getAttribute('aria-label') || e.title || '').toLowerCase().includes(wanted));
    if (!el) return 'NOT FOUND';
    el.click(); await new Promise(r => setTimeout(r, 600)); return 'clicked: ' + (el.innerText || el.title || '').trim().slice(0, 60);`,
  route: (hash) => `location.hash = ${JSON.stringify(hash)}; await new Promise(r => setTimeout(r, 900)); return location.hash;`,
  body: () => `return document.body.innerText.slice(0, 6000);`,
  errors: () => `return (window.__whErrors || []).slice(-20);`,
  // fill 'selector::value' — React ignores a plain .value assignment, so go
  // through the native setter and dispatch the events it listens for.
  fill: (arg) => {
    const [sel, ...rest] = arg.split('::');
    const value = rest.join('::');
    return `
      const el = document.querySelector(${JSON.stringify(sel.trim())});
      if (!el) return 'NOT FOUND';
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      return 'filled: ' + el.value;`;
  },
  inputs: () => `
    return [...document.querySelectorAll('input, textarea, select')].slice(0, 25).map((el, i) => ({
      i, tag: el.tagName, type: el.type, placeholder: el.placeholder || null,
      value: (el.value || '').slice(0, 40), id: el.id || null, name: el.name || null,
    }));`,
  key: (arg) => {
    const [sel, ...rest] = arg.split('::');
    const key = rest.join('::') || 'Enter';
    return `
      const el = ${JSON.stringify(sel.trim())} ? document.querySelector(${JSON.stringify(sel.trim())}) : document.activeElement;
      if (!el) return 'NOT FOUND';
      el.focus();
      for (const type of ['keydown', 'keypress', 'keyup']) {
        el.dispatchEvent(new KeyboardEvent(type, { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
      }
      await new Promise(r => setTimeout(r, 400));
      return 'key ' + ${JSON.stringify(key)};`;
  },
};

const [command, ...rest] = process.argv.slice(2);
const arg = rest.join(' ');
const build = EXPRESSIONS[command];
if (!build && command !== 'shot' && command !== 'file') {
  console.error('commands: ' + Object.keys(EXPRESSIONS).join(', '));
  process.exit(2);
}
// `file <path>` runs a script file verbatim — the reliable way to send anything
// with quotes or newlines through a shell.
let expression = null;
if (command === 'file') {
  const fs = await import('node:fs');
  expression = fs.readFileSync(arg, 'utf8');
} else if (command !== 'shot') {
  expression = build(arg);
}

const target = await pickTarget();
const ws = await connect(target.webSocketDebuggerUrl);
try {
  if (command === 'shot') {
    const shot = await send(ws, 7001, 'Page.captureScreenshot', { format: 'png' });
    const fs = await import('node:fs');
    fs.writeFileSync(arg || 'shot.png', Buffer.from(shot.data, 'base64'));
    console.log('wrote ' + (arg || 'shot.png'));
  } else {
    const value = await evaluate(ws, expression);
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  }
} finally {
  ws.close();
}
