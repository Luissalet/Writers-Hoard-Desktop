import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { sanitizedHtml } from '@/utils/sanitizeRichHtml';
import { canExportPdf } from '@/engines/writings/manuscriptExport';
import {
  buildPublishingPreview,
  getCitations,
  PUBLISHING_WORDS_PER_PAGE,
  type PublishingOutput,
  type PublishingPreviewContent,
} from '@/services/projectTools';
import type { Project, Writing } from '@/types';
import type { Citation, PublishingProfile } from '@/types/projectTools';

export interface PublishingPreviewPaneProps {
  project: Pick<Project, 'id' | 'title'>;
  /** The live profile draft. Recompiles are debounced, never per keystroke. */
  profile: PublishingProfile;
  /** Already scoped to the project, exactly as the export path resolves them. */
  writings: Writing[];
  titleOverride?: string;
}

/** Long enough that a typed profile name never compiles mid-word. */
const PREVIEW_DEBOUNCE_MS = 350;

/**
 * DOCX and ePub are the portable pair. Both read `section.portableHtml` —
 * `buildPublishingDocx` calls `paragraphsFromHtml(section.portableHtml, …)`
 * and `buildPublishingEpub` calls `toXhtmlFragment(section.portableHtml)` —
 * which is the IR with every image removed (`PORTABLE_PUBLISHING_IMAGE_POLICY`
 * is `'omit-all'`). Markdown, HTML and PDF all read `section.html` instead.
 */
function isPortableOutput(output: PublishingOutput): boolean {
  return output === 'docx' || output === 'epub';
}

interface FormatCaveat {
  /** Named `t` so the locale conformance gate sees these keys as literals. */
  text: (t: (key: string) => string) => string;
  applies: (content: PublishingPreviewContent) => boolean;
}

/**
 * What each writer-visible format does to the IR that the others do not.
 * Every line below is read off the builder that produces that file, and is
 * shown only when the selection actually carries what it talks about — a
 * format that keeps everything this manuscript holds says nothing at all.
 * HTML and PDF are absent on purpose: `renderPublishingHtml` inlines
 * `section.html` untouched, and the PDF pipeline prints that same HTML.
 */
const FORMAT_CAVEATS: Partial<Record<PublishingOutput, FormatCaveat[]>> = {
  // htmlToMarkdown: `<img>` becomes `![]($1)`; there is no `<table>` rule, so
  // the final `s.replace(/<[^>]+>/g, '')` strips the grid; `<h4>`…`<h6>` all
  // collapse into `'\n\n#### $1\n\n'`.
  markdown: [
    { text: t => t('projectTools.publishing.preview.caveat.markdown.images'), applies: content => content.images },
    { text: t => t('projectTools.publishing.preview.caveat.markdown.tables'), applies: content => content.tables },
    { text: t => t('projectTools.publishing.preview.caveat.markdown.headings'), applies: content => content.deepHeadings },
  ],
  // buildPublishingDocx: builds from `portableHtml`; `inlineChildren` turns an
  // `<a>` into `underline: true` and never writes its href; `<hr>` becomes a
  // centred `'* * *'`; `headingFor` maps `h1` to HEADING_2 because the piece
  // title already holds HEADING_1.
  docx: [
    { text: t => t('projectTools.publishing.preview.caveat.docx.images'), applies: content => content.images },
    { text: t => t('projectTools.publishing.preview.caveat.docx.links'), applies: content => content.links },
    { text: t => t('projectTools.publishing.preview.caveat.docx.sceneBreaks'), applies: content => content.sceneBreaks },
    { text: t => t('projectTools.publishing.preview.caveat.docx.headings'), applies: content => content.headings },
  ],
  // buildPublishingEpub: `serializeXhtmlNode` returns `''` for `img`, and
  // pushes only `href` (on `<a>`) and `title` as attributes — so colspan and
  // rowspan never reach the book. Links keep their address here; tables keep
  // their rows.
  epub: [
    { text: t => t('projectTools.publishing.preview.caveat.epub.images'), applies: content => content.images },
    { text: t => t('projectTools.publishing.preview.caveat.epub.attributes'), applies: content => content.mergedCells },
  ],
};

const chipClass = 'rounded-lg border px-2.5 py-1 text-xs transition';
const activeChip = 'border-accent-gold bg-accent-gold/10 text-accent-gold';
const idleChip = 'border-border text-text-muted hover:border-accent-gold hover:text-accent-gold';
/** Mirrors the exported CSS: indented paragraphs, italic quotes, fluid images. */
const bodyClass = 'mt-3 text-sm leading-relaxed text-text-primary '
  + '[&_p]:my-0.5 [&_p]:[text-indent:1.6em] [&_p:first-of-type]:[text-indent:0] '
  + '[&_h1]:my-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:my-2 [&_h2]:text-sm [&_h2]:font-semibold '
  + '[&_h3]:my-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h4]:my-2 [&_h4]:text-sm [&_h5]:my-2 [&_h5]:text-sm [&_h6]:my-2 [&_h6]:text-sm '
  + '[&_blockquote]:mx-6 [&_blockquote]:my-2 [&_blockquote]:italic [&_blockquote]:text-text-muted '
  + '[&_ul]:my-2 [&_ul]:list-disc [&_ol]:my-2 [&_ol]:list-decimal [&_li]:ml-6 '
  + '[&_hr]:my-4 [&_hr]:border-border [&_img]:my-2 [&_img]:max-w-full '
  + '[&_pre]:my-2 [&_pre]:whitespace-pre-wrap [&_pre]:font-mono [&_pre]:text-xs '
  + '[&_table]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-1.5 '
  + '[&_th]:border [&_th]:border-border [&_th]:px-1.5 [&_a]:underline';

/**
 * The manuscript as the file will carry it, compiled by the same
 * `buildPublishingArtifacts` the export buttons run.
 */
export default function PublishingPreviewPane({
  project,
  profile,
  writings,
  titleOverride,
}: PublishingPreviewPaneProps) {
  const { t, locale } = useTranslation();
  const outputs = useMemo<PublishingOutput[]>(
    () => (canExportPdf()
      ? ['markdown', 'html', 'docx', 'epub', 'pdf']
      : ['markdown', 'html', 'docx', 'epub']),
    [],
  );
  const [target, setTarget] = useState<PublishingOutput>(() => (canExportPdf() ? 'pdf' : 'html'));
  const [citations, setCitations] = useState<Citation[]>([]);
  // Compiling on every keystroke of the profile name would sanitize and parse
  // the manuscript once per letter, so the draft is followed at a distance.
  const [compiled, setCompiled] = useState<PublishingProfile>(profile);

  useEffect(() => {
    if (compiled === profile) return undefined;
    const timer = setTimeout(() => setCompiled(profile), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [compiled, profile]);

  const needsBibliography = profile.includeBibliography;
  useEffect(() => {
    if (!needsBibliography) return undefined;
    let live = true;
    void getCitations(project.id)
      .then(rows => { if (live) setCitations(rows); })
      .catch((error: unknown) => {
        console.error('Publishing preview citations failed', error);
        if (live) setCitations([]);
      });
    return () => { live = false; };
  }, [needsBibliography, project.id]);

  // `project` arrives as a fresh literal from the Writings shortcut, so the
  // compile is keyed on its fields instead of its identity.
  const previewProject = useMemo(
    () => ({ id: project.id, title: project.title }),
    [project.id, project.title],
  );
  const preview = useMemo(
    () => buildPublishingPreview(previewProject, compiled, writings, citations, { titleOverride }),
    [citations, compiled, previewProject, titleOverride, writings],
  );
  const retractedCount = citations.filter(citation => citation.retractedAt).length;

  const outputLabels: Record<PublishingOutput, string> = {
    markdown: 'Markdown',
    html: 'HTML',
    pdf: 'PDF',
    docx: t('projectTools.publishing.output.docx'),
    epub: t('projectTools.publishing.output.epub'),
  };
  const caveats = outputs
    .map(output => ({
      output,
      lines: (FORMAT_CAVEATS[output] ?? []).filter(caveat => caveat.applies(preview.content)),
    }))
    .filter(entry => entry.lines.length > 0);
  const portable = isPortableOutput(target);
  const stale = compiled !== profile;
  const documentLocale = preview.document.locale;

  return (
    <section aria-busy={stale} className="rounded-lg border border-border bg-deep/40 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-text-primary">
          {t('projectTools.publishing.preview.title')}
        </h3>
        {stale && (
          <Loader2
            size={13}
            role="img"
            className="animate-spin text-text-dim"
            aria-label={t('projectTools.publishing.preview.updating')}
          />
        )}
        <p className="ml-auto text-xs text-text-dim">
          {/* One page is "1 página", not "1 páginas": the estimate is the first
              number a writer reads before sending a file, so it has to be
              written like a sentence. Same for a single writing. */}
          {t(
            preview.pageEstimate === 1
              ? (preview.pieceCount === 1
                ? 'projectTools.publishing.preview.estimateOnePageOnePiece'
                : 'projectTools.publishing.preview.estimateOnePage')
              : (preview.pieceCount === 1
                ? 'projectTools.publishing.preview.estimateOnePiece'
                : 'projectTools.publishing.preview.estimate'),
          )
            .replace('{pieces}', preview.pieceCount.toLocaleString(locale))
            .replace('{words}', preview.wordCount.toLocaleString(locale))
            .replace('{pages}', preview.pageEstimate.toLocaleString(locale))
            .replace('{perPage}', PUBLISHING_WORDS_PER_PAGE.toLocaleString(locale))}
        </p>
      </div>

      <div
        role="group"
        aria-label={t('projectTools.publishing.preview.target')}
        className="mb-3 flex flex-wrap gap-1.5"
      >
        {outputs.map(output => (
          <button
            key={output}
            type="button"
            aria-pressed={output === target}
            onClick={() => setTarget(output)}
            className={`${chipClass} ${output === target ? activeChip : idleChip}`}
          >
            {outputLabels[output]}
          </button>
        ))}
      </div>

      {caveats.length > 0 ? (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <p className="text-xs font-semibold text-amber-300">
            {t('projectTools.publishing.preview.caveats')}
          </p>
          {caveats.map(entry => (
            <div key={entry.output} className="mt-1.5">
              <p className="text-[11px] font-semibold text-text-muted">{outputLabels[entry.output]}</p>
              <ul className="mt-0.5 list-disc pl-4 text-[11px] text-text-muted">
                {entry.lines.map((caveat, index) => (
                  <li key={`${entry.output}-${index}`}>{caveat.text(t)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-3 text-xs text-text-dim">
          {t('projectTools.publishing.preview.caveatsNone')}
        </p>
      )}

      {preview.googleDocsWithoutContent.length > 0 && (
        <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {t('projectTools.publishing.googleDocsEmptyError')
            .replace('{titles}', preview.googleDocsWithoutContent.map(item => item.title).join(', '))}
        </p>
      )}

      <div
        className={`max-h-96 overflow-y-auto rounded-lg border border-border bg-surface px-4 py-4 font-serif transition-opacity ${stale ? 'opacity-60' : ''}`}
      >
        {preview.pieces.length === 0 ? (
          <p className="py-6 text-center font-sans text-sm text-text-dim">
            {writings.length === 0
              ? t('projectTools.publishing.noWritings')
              : t('projectTools.publishing.selectSomething')}
          </p>
        ) : (
          <>
            {preview.document.includeTitlePage && (
              <div className="mb-6 border-b border-border pb-5 text-center">
                <p className="text-lg text-text-primary">{preview.document.title}</p>
                {/* The whole selection's total, because that is what the file's
                    title page will add up — the preview compiles fewer bodies. */}
                <p className="mt-1 text-xs italic text-text-muted">
                  {`${preview.wordCount.toLocaleString(documentLocale)} ${preview.document.wordLabel} · ${new Date(preview.document.generatedAt).toLocaleDateString(documentLocale)}`}
                </p>
              </div>
            )}

            {/* The file's contents page, so ticking the box shows something
                here and not only in the download. The listed pieces only:
                the outline past the preview limit is counted below. */}
            {preview.document.includeToc && (
              <nav className="mb-6 border-b border-border pb-5" aria-label={preview.document.tocTitle}>
                <h4 className="text-center text-base text-text-primary">{preview.document.tocTitle}</h4>
                <ol className="mx-auto mt-2 max-w-md list-decimal pl-6 text-xs text-text-muted">
                  {preview.pieces.map(piece => (
                    <li key={`toc-${piece.id}`} className="mt-1">{piece.title}</li>
                  ))}
                </ol>
              </nav>
            )}

            {preview.pieces.map(piece => (
              <article key={piece.id} className="mb-6 last:mb-0">
                <h4 className="text-center text-base text-text-primary">{piece.title}</h4>
                {piece.synopsis && (
                  <p className="mt-1 text-center text-xs italic text-text-muted">{piece.synopsis}</p>
                )}
                {piece.bodyCompiled ? (
                  <div
                    className={bodyClass}
                    dangerouslySetInnerHTML={sanitizedHtml(portable ? piece.portableHtml : piece.html)}
                  />
                ) : (
                  <p className="mt-1.5 text-center font-sans text-[11px] text-text-dim">
                    {`${piece.wordCount.toLocaleString(locale)} ${t('writings.words')} · ${t('projectTools.publishing.preview.bodyNotShown')}`}
                  </p>
                )}
              </article>
            ))}

            {preview.unlistedPieceCount > 0 && (
              <p className="mt-4 border-t border-border pt-3 text-center font-sans text-[11px] text-text-dim">
                {t('projectTools.publishing.preview.morePieces')
                  .replace('{count}', preview.unlistedPieceCount.toLocaleString(locale))}
              </p>
            )}

            {preview.document.bibliographyTitle && preview.document.bibliography.length > 0 && (
              <section className="mt-6 border-t border-border pt-4">
                <h4 className="text-center text-base text-text-primary">
                  {preview.document.bibliographyTitle}
                </h4>
                {retractedCount > 0 && (
                  <p className="mt-2 text-center font-sans text-[11px] text-warning" data-testid="publishing-preview-retracted">
                    {retractedCount === 1
                      ? t('projectTools.publishing.preview.retractedSourcesOne')
                      : t('projectTools.publishing.preview.retractedSources').replace('{count}', retractedCount.toLocaleString(locale))}
                  </p>
                )}
                {preview.document.bibliography.map((citation, index) => (
                  <p key={`citation-${index}`} className="mt-2 text-xs text-text-muted">{citation}</p>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </section>
  );
}
