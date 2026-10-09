// ============================================================================
// Beta reading — the script that runs inside the package page
// ============================================================================
//
// Plain ES5-style JavaScript, kept as a string because it is written into the
// package file and must run in any browser with no build step, no network and
// no library. It reads the manifest embedded in the page, lets the reader
// select text and comment on it, mark a reaction per chapter, and download the
// result as the response JSON that `parseResponse` reads.
//
// `__LABELS__` and `__REACTIONS__` are replaced by the builder with JSON.
// The rules for cutting a quote (collapsed whitespace, 40 characters of
// context, 600 at most) are the same ones `anchor.ts` documents; the test that
// loads a generated package keeps the two in step.
//
// No backtick and no dollar-brace may appear below: it is a String.raw literal.

export const READER_SCRIPT = String.raw`
(function () {
  'use strict';
  var L = __LABELS__;
  var REACTIONS = __REACTIONS__;
  var manifest = JSON.parse(document.getElementById('wh-manifest').textContent);
  var CONTEXT = 40, MAX_QUOTE = 600;
  var storeKey = 'wh-beta-' + manifest.packageId;
  var state = { reader: '', comments: [], reactions: {} };
  var lines = {};
  manifest.chapters.forEach(function (c) { lines[c.chapterId] = c.text.split('\n'); });

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function say(message) { $('wh-status').textContent = message; }

  // ---- persistence (best effort: a private window may refuse storage) ----
  function save() {
    try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(storeKey);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && Array.isArray(data.comments)) state = { reader: data.reader || '', comments: data.comments, reactions: data.reactions || {} };
      }
    } catch (e) { /* ignore */ }
  }

  // ---- text <-> DOM ----
  function charMap(block) {
    var walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    var map = [], text = '', prevSpace = true, node, s, i, ch;
    while ((node = walker.nextNode())) {
      s = node.nodeValue;
      for (i = 0; i < s.length; i++) {
        ch = s.charAt(i);
        if (/[\s\u00a0]/.test(ch)) {
          if (prevSpace) continue;
          prevSpace = true; text += ' '; map.push({ n: node, o: i });
        } else {
          prevSpace = false; text += ch; map.push({ n: node, o: i });
        }
      }
    }
    if (text.charAt(text.length - 1) === ' ') { text = text.slice(0, -1); map.pop(); }
    return { text: text, map: map };
  }

  function blockOf(node) {
    while (node && node !== document.body) {
      if (node.nodeType === 1 && node.classList && node.classList.contains('b')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function currentSelection() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    var block = blockOf(range.startContainer);
    if (!block) return null;
    var article = block.parentNode;
    var data = charMap(block);
    var first = -1, last = -1, k;
    for (k = 0; k < data.map.length; k++) {
      if (first === -1 && range.comparePoint(data.map[k].n, data.map[k].o) >= 0) first = k;
      if (range.comparePoint(data.map[k].n, Math.min(data.map[k].o + 1, data.map[k].n.nodeValue.length)) <= 0
          && range.comparePoint(data.map[k].n, data.map[k].o) >= 0) last = k;
    }
    if (first === -1 || last < first) return null;
    var start = first, end = last + 1;
    while (start < end && data.text.charAt(start) === ' ') start++;
    while (end > start && data.text.charAt(end - 1) === ' ') end--;
    if (end <= start) return null;
    return {
      chapterId: article.getAttribute('data-chapter'),
      paragraph: parseInt(block.getAttribute('data-p'), 10),
      text: data.text, start: start, end: end
    };
  }

  function anchorFrom(sel) {
    var end = Math.min(sel.end, sel.start + MAX_QUOTE);
    return {
      chapterId: sel.chapterId,
      paragraph: sel.paragraph,
      quote: sel.text.slice(sel.start, end),
      prefix: sel.text.slice(Math.max(0, sel.start - CONTEXT), sel.start),
      suffix: sel.text.slice(end, end + CONTEXT)
    };
  }

  // ---- highlights ----
  function blockFor(chapterId, paragraph) {
    return document.querySelector('article[data-chapter="' + chapterId + '"] .b[data-p="' + paragraph + '"]');
  }

  function highlight(comment) {
    if (!comment.quote) return;
    var block = blockFor(comment.chapterId, comment.paragraph);
    if (!block) return;
    var data = charMap(block);
    var at = data.text.indexOf(comment.quote);
    if (at === -1) return;
    var runs = [], run = null, k;
    for (k = at; k < at + comment.quote.length; k++) {
      var m = data.map[k];
      if (run && run.n === m.n) run.to = m.o + 1;
      else { run = { n: m.n, from: m.o, to: m.o + 1 }; runs.push(run); }
    }
    runs.forEach(function (r) {
      var range = document.createRange();
      range.setStart(r.n, r.from); range.setEnd(r.n, r.to);
      var mark = document.createElement('mark');
      mark.setAttribute('data-c', comment.id);
      try { range.surroundContents(mark); } catch (e) { /* a range across elements: skip the mark */ }
    });
  }

  function unhighlight(id) {
    var marks = document.querySelectorAll('mark[data-c="' + id + '"]');
    Array.prototype.forEach.call(marks, function (mark) {
      var parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
  }

  // ---- comments ----
  function chapterTitle(id) {
    for (var i = 0; i < manifest.chapters.length; i++) if (manifest.chapters[i].chapterId === id) return manifest.chapters[i].title;
    return id;
  }

  function renderComments() {
    var box = $('wh-list');
    box.textContent = '';
    $('wh-count').textContent = String(state.comments.length);
    if (!state.comments.length) { box.appendChild(el('p', 'muted', L.noComments)); return; }
    state.comments.forEach(function (c) {
      var item = el('div', 'comment');
      item.setAttribute('data-comment', c.id);
      item.appendChild(el('div', 'where', chapterTitle(c.chapterId)));
      if (c.quote) item.appendChild(el('blockquote', '', c.quote));
      item.appendChild(el('p', '', c.text));
      var remove = el('button', 'link', L.remove);
      remove.type = 'button';
      remove.addEventListener('click', function () {
        state.comments = state.comments.filter(function (x) { return x.id !== c.id; });
        unhighlight(c.id); save(); renderComments(); say(L.removed);
      });
      item.appendChild(remove);
      box.appendChild(item);
    });
  }

  var pending = null;
  var composerAnchor = null;

  function openComposer(anchor) {
    composerAnchor = anchor;
    $('wh-composer').hidden = false;
    $('wh-composer-quote').textContent = anchor.quote ? anchor.quote : L.wholeChapter + ': ' + chapterTitle(anchor.chapterId);
    $('wh-comment-text').value = '';
    $('wh-comment-text').focus();
  }

  function closeComposer() {
    $('wh-composer').hidden = true;
    composerAnchor = null;
  }

  function addFromSelection() {
    var sel = currentSelection() || pending;
    if (!sel) { say(L.selectFirst); return; }
    openComposer(anchorFrom(sel));
  }

  function newId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function saveComment() {
    var text = $('wh-comment-text').value.replace(/^\s+|\s+$/g, '');
    if (!composerAnchor || !text) { say(L.writeSomething); return; }
    var comment = {
      id: newId(),
      chapterId: composerAnchor.chapterId,
      quote: composerAnchor.quote || '',
      prefix: composerAnchor.prefix || '',
      suffix: composerAnchor.suffix || '',
      paragraph: composerAnchor.paragraph || 0,
      text: text,
      createdAt: new Date().toISOString()
    };
    state.comments.push(comment);
    highlight(comment);
    closeComposer();
    var selection = window.getSelection();
    if (selection) selection.removeAllRanges();
    pending = null;
    save(); renderComments(); say(L.saved);
  }

  // ---- reactions ----
  function renderReactions(article, chapterId) {
    var row = article.querySelector('.reactions');
    Array.prototype.forEach.call(row.querySelectorAll('button'), function (button) {
      var key = button.getAttribute('data-reaction');
      var on = (state.reactions[chapterId] || []).indexOf(key) !== -1;
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function toggleReaction(chapterId, key) {
    var list = state.reactions[chapterId] || [];
    var at = list.indexOf(key);
    if (at === -1) list.push(key); else list.splice(at, 1);
    if (list.length) state.reactions[chapterId] = list; else delete state.reactions[chapterId];
    save();
    renderReactions(document.querySelector('article[data-chapter="' + chapterId + '"]'), chapterId);
  }

  // ---- export ----
  function buildResponse() {
    return {
      format: 'writers-hoard.beta-response',
      formatVersion: 1,
      packageId: manifest.packageId,
      packageVersion: manifest.version,
      reader: state.reader,
      exportedAt: new Date().toISOString(),
      chapters: manifest.chapters.map(function (c) { return { chapterId: c.chapterId, contentHash: c.contentHash }; }),
      reactions: state.reactions,
      comments: state.comments
    };
  }

  function exportResponse() {
    state.reader = $('wh-reader-name').value.replace(/^\s+|\s+$/g, '');
    if (!state.reader) { say(L.needName); $('wh-reader-name').focus(); return; }
    save();
    var blob = new Blob([JSON.stringify(buildResponse(), null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    var safe = state.reader.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'reader';
    link.href = url;
    link.download = 'beta-' + safe + '-v' + manifest.version + '.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    say(L.exported);
  }

  // ---- start ----
  function start() {
    load();
    $('wh-reader-name').value = state.reader;
    manifest.chapters.forEach(function (c) {
      var article = document.querySelector('article[data-chapter="' + c.chapterId + '"]');
      var row = article.querySelector('.reactions');
      REACTIONS.forEach(function (r) {
        var button = el('button', 'wh-react', r.emoji + ' ' + r.label);
        button.type = 'button';
        button.setAttribute('data-reaction', r.key);
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', function () { toggleReaction(c.chapterId, r.key); });
        row.appendChild(button);
      });
      renderReactions(article, c.chapterId);
      article.querySelector('.whole').addEventListener('click', function () {
        openComposer({ chapterId: c.chapterId, paragraph: 0, quote: '', prefix: '', suffix: '' });
      });
    });
    state.comments.forEach(highlight);
    renderComments();
    $('wh-add-comment').addEventListener('click', addFromSelection);
    $('wh-comment-save').addEventListener('click', saveComment);
    $('wh-comment-cancel').addEventListener('click', closeComposer);
    $('wh-export').addEventListener('click', exportResponse);
    $('wh-reader-name').addEventListener('change', function () {
      state.reader = $('wh-reader-name').value.replace(/^\s+|\s+$/g, ''); save();
    });
    document.addEventListener('selectionchange', function () {
      var sel = currentSelection();
      if (sel) pending = sel;
      $('wh-add-comment').disabled = !sel && !pending;
    });
    $('wh-add-comment').disabled = true;
  }

  start();
})();
`;
