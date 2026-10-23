import {useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Editor} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {BookDocument, ChapterHeadingNode} from '@/components/editor/chapterHeading/ChapterHeadingNode';
import {CHAPTER_HEADING_NAME} from '@/components/editor/chapterHeading/chapterBlocks';
import {FootnoteNode} from '@/components/editor/footnotes/FootnoteNode';
import FootnotesPanel from '@/components/editor/footnotes/FootnotesPanel';
import {collectFootnotes} from '@/components/editor/footnotes/footnoteModel';

const assert: (value: unknown, message: string) => asserts value = (value, message) => {if (!value) throw Error(message);};
export async function reviewFootnotesHandoff() {
  const editorHost = document.createElement('div'), panelHost = document.createElement('div');
  document.body.append(editorHost, panelHost);
  const root = createRoot(panelHost);
  const ref = (id: string) => `<sup data-footnote-id="${id}" data-footnote="${id}" class="wh-footnote-ref"></sup>`;
  const editor = new Editor({element: editorHost, extensions: [StarterKit.configure({document: false}), BookDocument, ChapterHeadingNode.configure({nodeView: false}), FootnoteNode], content: `<h1 data-writing-id="one">One</h1><p>First${ref('a')}${ref('b')}</p><h1 data-writing-id="two">Two</h1><p>Second${ref('c')}</p>`});
  let inserted = false;
  function Handoff() {
    // A parent layout effect runs after the child committed its visible panel,
    // but before passive subscriptions. Mutate through the real editor API.
    useLayoutEffect(() => {
      assert(panelHost.querySelectorAll('li').length === 3, 'Panel was not yet committed');
      let position = -1;
      editor.state.doc.descendants((node, pos) => {if (node.type.name === 'paragraph' && node.textContent.startsWith('Second')) position = pos + 1;});
      assert(position >= 0, 'Second chapter absent');
      editor.commands.setTextSelection(position);
      inserted = editor.commands.insertFootnote('new during commit');
    }, []);
    return <FootnotesPanel editor={editor} restartNumbersAt={CHAPTER_HEADING_NAME}/>;
  }
  try {
    flushSync(() => {root.render(<Handoff/>);});
    await new Promise(resolve => setTimeout(resolve, 30));
    const actual = collectFootnotes(editor.state.doc, CHAPTER_HEADING_NAME).map(row => row.index).join(',');
    const displayed = [...panelHost.querySelectorAll('li > span')].map(node => node.textContent).join(',');
    assert(inserted && actual === '1,2,1,2', 'Real editor did not receive fourth footnote: ' + actual);
    assert(displayed === actual, 'Panel missed committed editor transaction: actual=' + actual + '; displayed=' + displayed);
    return ['Footnote panel catches an actual document transaction between visible commit and passive subscription; chapter numbering stays current'];
  } finally {flushSync(() => {root.unmount();});editor.destroy();editorHost.remove();panelHost.remove();}
}
