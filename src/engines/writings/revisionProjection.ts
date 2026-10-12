import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { DOMParser as PmDomParser, DOMSerializer, type Node as PmNode } from '@tiptap/pm/model';
import { FootnoteNode } from '@/components/editor/footnotes/FootnoteNode';
import { createAdvancedExtensions } from '@/components/editor/advanced/extensions';
import { createRevisionExtensions, describeRevisionDocument, projectRevisionDocument } from './revisions';
import { createEditorialExtensions } from './editorial';

let chapterSchema: ReturnType<typeof getSchema> | undefined;

/** A detached projection never changes the chapter, its proposals or its undo. */
export function revisionDocumentHtml(doc: PmNode, decision: 'accept' | 'reject'): string {
  const host = document.createElement('div');
  host.appendChild(DOMSerializer.fromSchema(doc.type.schema).serializeFragment(projectRevisionDocument(doc, decision).content));
  return host.innerHTML;
}

/** Existing chapter readers/exporters use the final text, without concatenated originals. */
export function projectWritingHtml(html: string, decision: 'accept' | 'reject' = 'accept'): string {
  if (!html.includes('data-wh-revision-kind') && !html.includes('data-wh-revision-break-kind')) return html;
  const host = document.createElement('div'); host.innerHTML = html;
  if (!host.querySelector('[data-wh-revision-kind],[data-wh-revision-break-kind]')) return html;
  chapterSchema ??= getSchema([StarterKit.configure({ link: { openOnClick: false } }), Image.configure({ allowBase64: true }), FootnoteNode, ...createAdvancedExtensions(), ...createRevisionExtensions(), ...createEditorialExtensions()]);
  const doc = PmDomParser.fromSchema(chapterSchema).parse(host);
  return describeRevisionDocument(doc).length ? revisionDocumentHtml(doc, decision) : html;
}
