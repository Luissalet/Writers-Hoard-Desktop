// ============================================
// Scrapper Engine — Export the saved links as CSV
// ============================================
//
// Cheap insurance for the one table that cannot be rebuilt (lessons #67): a
// spreadsheet-friendly copy of every link, readable without the app. Read-only
// — it only serialises the rows it is handed.

import { saveAs } from 'file-saver';
import { preservationLevel } from './preservation';
import type { Snapshot } from './types';

const COLUMNS = [
  'url',
  'title',
  'description',
  'notes',
  'tags',
  'author',
  'publishDate',
  'source',
  'createdAt',
  'preservation',
] as const;

/**
 * One RFC 4180 field. Every field is quoted, so commas, quotes and line breaks
 * inside notes survive. A value a spreadsheet would run as a formula (leading
 * `=`, `+`, `-`, `@`, tab or carriage return) is prefixed with `'` — the
 * OWASP CSV-injection guard — so opening the export can never execute it.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function snapshotsToCsv(snapshots: Snapshot[]): string {
  const rows = snapshots.map((s) => [
    s.url ?? '',
    s.title ?? '',
    s.description ?? '',
    s.notes ?? '',
    (s.tags ?? []).join('; '),
    s.author ?? '',
    s.publishDate ?? '',
    s.source ?? '',
    Number.isFinite(s.createdAt) ? new Date(s.createdAt).toISOString() : '',
    preservationLevel(s),
  ]);
  // BOM so Excel reads accents as UTF-8; CRLF per RFC 4180.
  return '﻿' + [COLUMNS as readonly string[], ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n') + '\r\n';
}

/** Browser-native download (lessons #14) of the given clippings as CSV. */
export function downloadLinksCsv(snapshots: Snapshot[]): void {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([snapshotsToCsv(snapshots)], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, `recortes-${date}.csv`);
}
