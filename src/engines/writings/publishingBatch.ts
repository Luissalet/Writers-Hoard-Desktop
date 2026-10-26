import { db } from '@/db';
import { listEraRows } from '@/services/worldEras/store';
import { manuscriptProject } from './manuscripts';
import { safeReaderPresentation } from './readerPresentation';
import { capturePrintCover, encodePrintCover, type PrintCoverLayout } from './coverDesign/print';
import {
  currentPublishingLabels, preparePublishingArtifacts, resolvePublishingWritings,
  type PublishingArtifactLabels, type PublishingArtifacts,
} from '@/services/projectTools';
import type { PublishingProfile } from '@/types/projectTools';
import type { Project, Writing } from '@/types';

export const PUBLISHING_BATCH_OUTPUTS = ['markdown', 'html', 'epub', 'docx', 'pdf', 'print-cover'] as const;
export type PublishingBatchOutput = typeof PUBLISHING_BATCH_OUTPUTS[number];
export interface PublishingBatchFile {
  output: PublishingBatchOutput;
  status: 'ready' | 'failed' | 'canceled';
  filename: string;
  mime: string;
  bytes?: Uint8Array;
  error?: string;
  report?: unknown;
}
export interface PublishingBatchCapture {
  readonly projectId: string;
  readonly profileId: string;
  readonly title: string;
  readonly capturedAt: number;
  readonly pieces: number;
  readonly wordCount: number;
  readonly omittedImageCount: number;
  readonly missingWritingIds: readonly string[];
  readonly googleDocsWithoutContent: ReadonlyArray<{ id: string; title: string }>;
}
export interface PublishingBatchOptions {
  projectId: string;
  profile?: PublishingProfile;
  profileId?: string;
  eraId?: string;
  titleOverride?: string;
  generatedAt?: number;
  labels?: PublishingArtifactLabels;
  printLayout?: PrintCoverLayout & { dpi?: number };
}
interface CapturedInputs {
  artifacts: PublishingArtifacts;
  project: Project;
  printLayout?: PrintCoverLayout & { dpi?: number };
}
// Callers cannot detach or mutate the snapshot. Every encoder receives its own copy.
const captures = new WeakMap<PublishingBatchCapture, CapturedInputs>();

/** One readonly acquisition. Materialization/composition happens only after it closes. */
export async function capturePublishingBatch(options: PublishingBatchOptions, { signal }: { signal?: AbortSignal } = {}): Promise<PublishingBatchCapture> {
  abortIfNeeded(signal);
  const request = structuredClone(options);
  const capturedAt = request.generatedAt ?? Date.now();
  const labels = request.labels ?? Object.fromEntries(
    (['manuscript', 'screenplay', 'research', 'biography', 'video'] as const)
      .map(format => [format, currentPublishingLabels(format)]),
  );
  if (!!request.profile === !!request.profileId) throw Error('publishing_profile_exclusive');
  const tables = ['projects', 'writings', 'writingSnapshots', 'worldEraVariants', 'worldEraAssets', 'documentArchives', 'citations'];
  if (request.profileId) tables.push('publishingProfiles');
  let abortTransaction: (() => void) | undefined;
  const acquired = await db.transaction('r', tables, async transaction => {
    abortTransaction = () => transaction.abort();
    signal?.addEventListener('abort', abortTransaction, { once: true });
    abortIfNeeded(signal);
    const stored = await db.projects.get(request.projectId);
    if (!stored) throw Error('project_missing');
    const profile = request.profile ?? await db.publishingProfiles.get(request.profileId!);
    if (!profile || profile.projectId !== request.projectId) throw Error('publishing_profile_missing');
    // This resolver retains Base, inherited era rows, snapshot children and
    // structural owners from variant/archive history inside this transaction.
    const writings = await listEraRows<Writing>({ projectId: request.projectId, eraId: request.eraId }, 'writings');
    const resolved = resolvePublishingWritings(writings, profile);
    if (!resolved.writings.length || resolved.googleDocsWithoutContent.length) throw Object.assign(
      Error(!resolved.writings.length ? 'no-writings' : 'google-docs-without-content'),
      { missingWritingIds: resolved.missingWritingIds, googleDocsWithoutContent: resolved.googleDocsWithoutContent.map(({ id, title }) => ({ id, title })) },
    );
    const citations = profile.includeBibliography ? await db.citations.where('projectId').equals(request.projectId).toArray() : [];
    return structuredClone({
      project: manuscriptProject(stored, profile.writingScope, request.eraId),
      profile, writings: resolved.writings, citations,
      missingWritingIds: resolved.missingWritingIds,
      googleDocsWithoutContent: resolved.googleDocsWithoutContent.map(({ id, title }) => ({ id, title })),
    });
  }).finally(() => { if (abortTransaction) signal?.removeEventListener('abort', abortTransaction); });
  abortIfNeeded(signal);
  const artifactLabels = request.labels ?? (labels as Record<string, PublishingArtifactLabels>)[acquired.profile.format];
  const artifacts = await preparePublishingArtifacts(acquired.project, acquired.profile, acquired.writings, acquired.citations, {
    generatedAt: capturedAt, titleOverride: request.titleOverride, labels: artifactLabels,
  });
  abortIfNeeded(signal);
  const capture: PublishingBatchCapture = Object.freeze({
    projectId: request.projectId, profileId: acquired.profile.id,
    title: artifacts.document.title, capturedAt, pieces: artifacts.document.sections.length,
    wordCount: artifacts.document.wordCount,
    omittedImageCount: artifacts.document.omittedPortableImageCount,
    missingWritingIds: Object.freeze(acquired.missingWritingIds),
    googleDocsWithoutContent: Object.freeze(acquired.googleDocsWithoutContent.map(row => Object.freeze(row))),
  });
  captures.set(capture, { artifacts, project: acquired.project, printLayout: request.printLayout });
  return capture;
}

const MIME: Record<PublishingBatchOutput, string> = {
  markdown: 'text/markdown', html: 'text/html', epub: 'application/epub+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf', 'print-cover': 'application/pdf',
};
function dataBytes(dataUrl: string): Uint8Array {
  const text = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(text, char => char.charCodeAt(0));
}
function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export canceled', 'AbortError');
}

/** No database, clock, locale reads or downloads; retry uses exactly this capture. */
export async function encodePublishingBatch(
  capture: PublishingBatchCapture,
  outputs: readonly PublishingBatchOutput[],
  options: { signal?: AbortSignal; onResult?: (result: PublishingBatchFile) => void } = {},
): Promise<PublishingBatchFile[]> {
  const source = captures.get(capture);
  if (!source) throw Error('publishing_capture_invalid');
  if (!outputs.length || outputs.some(output => !PUBLISHING_BATCH_OUTPUTS.includes(output))) throw Error('publishing_outputs_invalid');
  const results: PublishingBatchFile[] = [];
  for (const output of new Set(outputs)) {
    const stem = source.artifacts.pdfFilename.slice(0, -4);
    const filename = output === 'print-cover' ? `${stem}-print-cover.pdf`
      : output === 'markdown' ? source.artifacts.markdownFilename : `${stem}.${output}`;
    let result: PublishingBatchFile = { output, filename, mime: MIME[output], status: 'canceled' };
    try {
      abortIfNeeded(options.signal);
      let bytes: Uint8Array;
      let report: unknown;
      if (output === 'markdown' || output === 'html') {
        bytes = new TextEncoder().encode(source.artifacts[output]);
      } else if (output === 'pdf') {
        const { renderPublishingPdf } = await import('./pdf/publishingPdf');
        abortIfNeeded(options.signal);
        ({ bytes, report } = await renderPublishingPdf(structuredClone(source.artifacts.document), { signal: options.signal }));
      } else if (output === 'print-cover') {
        if (!source.printLayout) throw Error('print_cover_layout_required');
        const { dpi, ...layout } = source.printLayout;
        if (dpi === undefined) throw Error('print_cover_dpi_required');
        const project = structuredClone(source.project);
        const raster = await capturePrintCover(project.title, project.coverImage, safeReaderPresentation(project.readerPresentation).cover, layout, dpi);
        abortIfNeeded(options.signal);
        const encoded = await encodePrintCover(raster, 'pdf');
        bytes = dataBytes(encoded.dataUrl);
        report = { layoutMm: raster.layoutMm, dpi: raster.dpi, boxesPt: raster.boxesPt };
      } else {
        const document = structuredClone(source.artifacts.document);
        const blob = output === 'docx'
          ? await (await import('./publishingDocx')).buildPublishingDocx(document)
          : await (await import('./publishingEpub')).buildPublishingEpub(document);
        bytes = new Uint8Array(await blob.arrayBuffer());
      }
      abortIfNeeded(options.signal);
      result = { ...result, status: 'ready', bytes: bytes.slice(), ...(report === undefined ? {} : { report }) };
    } catch (error) {
      result = { ...result, status: options.signal?.aborted || error instanceof DOMException && error.name === 'AbortError' ? 'canceled' : 'failed', error: error instanceof Error ? error.message : String(error) };
    }
    results.push(result);
    options.onResult?.(result);
  }
  return results;
}
