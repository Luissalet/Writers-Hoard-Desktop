import type { Writing } from '@/types';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { countWords } from '@/utils/text';

/**
 * Portable exports deliberately omit every image. In particular, they never
 * fetch remote URLs while producing a document. HTML/PDF keep their existing
 * sanitized images; DOCX/ePub consume `portableHtml` instead.
 */
export const PORTABLE_PUBLISHING_IMAGE_POLICY = 'omit-all' as const;

export interface PublishingDocumentSection {
  id: string;
  title: string;
  synopsis?: string;
  html: string;
  portableHtml: string;
  wordCount: number;
  omittedImageCount: number;
}

export interface PublishingDocument {
  identifier: string;
  title: string;
  locale: string;
  generatedAt: number;
  includeTitlePage: boolean;
  wordLabel: string;
  wordCount: number;
  sections: PublishingDocumentSection[];
  bibliographyTitle?: string;
  bibliography: string[];
  omittedPortableImageCount: number;
}

export interface PublishingDocumentOptions {
  identifier?: string;
  projectTitle: string;
  includeTitlePage: boolean;
  includeSynopsis: boolean;
  chapterLabel: string;
  wordLabel?: string;
  locale?: string;
  generatedAt?: number;
  bibliographyTitle?: string;
  bibliography?: readonly string[];
}

function chapterHeading(writing: Writing, options: PublishingDocumentOptions): string {
  return writing.chapter !== undefined
    ? `${options.chapterLabel} ${writing.chapter} — ${writing.title}`
    : writing.title;
}

function omitImages(html: string): { html: string; count: number } {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const images = [...document.body.querySelectorAll('img')];
  for (const image of images) image.remove();
  return { html: document.body.innerHTML, count: images.length };
}

/** Compose titles, sanitized bodies, metadata, and bibliography exactly once. */
export function composePublishingDocument(
  writings: readonly Writing[],
  options: PublishingDocumentOptions,
): PublishingDocument {
  const sections = writings.map((writing) => {
    const html = sanitizeRichHtml(writing.content);
    const portable = omitImages(html);
    return {
      id: writing.id,
      title: chapterHeading(writing, options),
      synopsis: options.includeSynopsis && writing.synopsis ? writing.synopsis : undefined,
      html,
      portableHtml: portable.html,
      wordCount: writing.wordCount || countWords(writing.content),
      omittedImageCount: portable.count,
    };
  });
  return {
    identifier: options.identifier ?? `urn:writers-hoard:${encodeURIComponent(options.projectTitle)}`,
    title: options.projectTitle,
    locale: options.locale ?? 'en-US',
    generatedAt: options.generatedAt ?? Date.now(),
    includeTitlePage: options.includeTitlePage,
    wordLabel: options.wordLabel ?? 'words',
    wordCount: sections.reduce((total, section) => total + section.wordCount, 0),
    sections,
    bibliographyTitle: options.bibliographyTitle,
    bibliography: [...(options.bibliography ?? [])],
    omittedPortableImageCount: sections.reduce((total, section) => total + section.omittedImageCount, 0),
  };
}
