export const READER_PRESENTATION_CSS = `.wh-reader-cover-stage{height:370px;display:grid;place-items:center;perspective:1000px;touch-action:none;cursor:grab;user-select:none}
.wh-reader-cover-stage:active{cursor:grabbing}
.wh-reader-book{position:relative;width:210px;height:300px;transform-style:preserve-3d}
.wh-reader-book-front,.wh-reader-book-back{position:absolute;inset:0;background:var(--book-color);color:var(--book-ink);border:1px solid color-mix(in srgb,var(--book-ink) 25%,transparent);backface-visibility:hidden}
.wh-reader-book-front{transform:translateZ(var(--book-half));display:grid;place-items:center;overflow:hidden;box-shadow:inset 5px 0 8px #0003}
.wh-reader-book-front>span{padding:28px;text-align:center;font:700 27px/1.3 Georgia,serif;overflow-wrap:anywhere;z-index:1}
.wh-reader-book-front>img{width:100%;height:100%;object-fit:cover}
.wh-reader-book-front[data-texture=linen]:before{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,#fff1 0 1px,transparent 1px 3px),repeating-linear-gradient(90deg,#0001 0 1px,transparent 1px 3px)}
.wh-reader-book-front[data-texture=lines]:before{content:'';position:absolute;inset:10px;pointer-events:none;border:1px solid currentColor;opacity:.4}
.wh-reader-book-back{transform:translateZ(calc(-1 * var(--book-half))) rotateY(180deg)}
.wh-reader-book-spine{position:absolute;left:0;top:0;width:var(--book-depth);height:100%;transform:translateZ(calc(-1 * var(--book-half))) rotateY(-90deg);transform-origin:left center;background:var(--book-color);color:var(--book-ink);border:1px solid #0004;display:flex;align-items:center;justify-content:center;overflow:hidden}
.wh-reader-book-spine span{writing-mode:vertical-rl;font:13px Georgia,serif;max-height:85%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.wh-reader-book-pages{position:absolute;left:100%;top:3px;width:var(--book-depth);height:calc(100% - 6px);transform:translateZ(var(--book-half)) rotateY(90deg);transform-origin:left center;background:repeating-linear-gradient(90deg,#eee9dc 0 2px,#bcb7ad 2px 3px)}
.wh-reader-themed .ProseMirror{color:var(--reader-ink);font-family:var(--reader-font,var(--wh-reading-font))}
.wh-reader-themed .ProseMirror h1,.wh-reader-themed .ProseMirror h2,.wh-reader-themed .ProseMirror h3{color:var(--reader-ink)}
.wh-reader-themed .ProseMirror blockquote{color:inherit}
.wh-reader-pages .ProseMirror{height:65vh;max-height:640px;column-width:50ch;column-gap:3rem;column-fill:auto;overflow-x:auto;overflow-y:hidden;padding-bottom:20px}
.wh-reader-pages .ProseMirror figure,.wh-reader-pages .ProseMirror img{break-inside:avoid}
.wh-reader-chapter-image{display:block;max-height:24rem;max-width:100%;object-fit:contain;margin:0 auto 24px}
@media(min-width:1000px){.wh-reader-image-beside{float:left;max-width:35%;max-height:28rem;margin:0 24px 24px 0}}
@media(max-width:1023px){.wh-reader-studio-cover .wh-reader-cover-stage{height:225px}.wh-reader-studio-cover .wh-reader-book{width:147px;height:210px}.wh-reader-studio-cover .wh-reader-book-front>span{padding:16px;font-size:20px}}
@media print{.wh-reader-cover input{display:none}.wh-reader-pages .ProseMirror{height:auto;max-height:none;columns:auto;overflow:visible}}
`;
