const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const pid = 'proj_mthy3jeu_q7kvd1';
const dbMod = await import('/src/db/index.ts');
const db = dbMod.db;

const rows = (await db.writings.where('projectId').equals(pid).toArray())
  .filter((w) => (w.chapter ?? 0) > 0)
  .sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0));
const one = rows[0], two = rows[1];
out.chapters = [one?.title, two?.title];
out.before = { one: (one?.content || '').slice(0, 70), two: (two?.content || '').slice(0, 70) };

// Open chapter 1 from the list.
location.hash = `#/project/${pid}/writings?writing=${encodeURIComponent(one.id)}`;
await sleep(3000);
const prose = document.querySelector('.ProseMirror');
out.openedOne = prose ? (prose.innerText || '').slice(0, 60) : '(no editor)';

// Type into it, so the undo stack has something in it.
if (prose) {
  prose.focus();
  document.execCommand('insertText', false, ' PALABRA_NUEVA');
  await sleep(2500);
}
out.afterTyping = document.querySelector('.ProseMirror')?.innerText.slice(0, 90);

// Switch to chapter 2 with the app's own navigation.
const next = [...document.querySelectorAll('button')].find((b) =>
  /siguiente|next/i.test(b.getAttribute('aria-label') || b.title || ''),
);
out.usedChevron = Boolean(next);
if (next) next.click();
else location.hash = `#/project/${pid}/writings?writing=${encodeURIComponent(two.id)}`;
await sleep(3000);
out.openedTwo = document.querySelector('.ProseMirror')?.innerText.slice(0, 70);

// The dangerous keystroke: one undo, immediately after arriving.
const target = document.querySelector('.ProseMirror');
if (target) {
  target.focus();
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
}
await sleep(3500);
out.afterUndo = document.querySelector('.ProseMirror')?.innerText.slice(0, 90);

// What actually reached the database.
await sleep(2500);
const oneNow = await db.writings.get(one.id);
const twoNow = await db.writings.get(two.id);
out.after = { one: (oneNow?.content || '').slice(0, 90), two: (twoNow?.content || '').slice(0, 90) };
out.chapterTwoIntact = !(twoNow?.content || '').includes('PALABRA_NUEVA');
return JSON.stringify(out, null, 2);
