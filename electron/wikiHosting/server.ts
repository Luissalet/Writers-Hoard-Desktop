import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { crc32 } from 'node:zlib';
import {
  READ_HOST_KEY_PREFIX, WIKI_HOST_COVER_IMAGE, WIKI_HOST_SLUG,
  type ReadHostAddress, type ReadHostChange, type ReadHostListScope, type ReadHostOwner, type ReadHostPublication,
  type WikiHostAddress, type WikiHostChange, type WikiHostListScope, type WikiHostOwner, type WikiHostPublication,
} from '../../src/services/wikiProfiles/hostingTypes';

const BIND = '127.0.0.1';
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const isId = (id: string) => typeof id === 'string' && id.length > 0 && id.length <= 200;

type AddressRow = Omit<WikiHostAddress, 'active' | 'url' | 'coverUrl'> & { active: number; token: string | null };
type Row = AddressRow & { html: string; cover?: string | null };
type WikiReaderOptions = { port: number; publicOrigin?: string };
const ADDRESS_COLUMNS = 'slug, projectId, profileId, editionId, audience, sha256, revision, active, token, cover IS NOT NULL AS hasCover';

function completePng(bytes: Buffer) {
  if (bytes.length < 57 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
    !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20)) return false;
  let hasData = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 8 + length;
    if (end + 4 > bytes.length || crc32(bytes.subarray(offset + 4, end)) !== bytes.readUInt32BE(end)) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT' && length) hasData = true;
    if (type === 'IEND') return hasData && length === 0 && end + 4 === bytes.length;
    offset = end + 4;
  }
  return false;
}

function decodeCover(value: unknown) {
  const match = typeof value === 'string' && WIKI_HOST_COVER_IMAGE.exec(value);
  if (!match) throw Error('wiki_host_cover_invalid');
  const [, mime, encoded] = match;
  const bytes = Buffer.from(encoded, 'base64');
  const valid = mime === 'image/png' ? completePng(bytes)
    : mime === 'image/jpeg' ? bytes.length > 16 && bytes.subarray(0, 3).toString('hex') === 'ffd8ff' && bytes.readUInt16BE(bytes.length - 2) === 0xffd9
    : bytes.length > 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.readUInt32LE(4) + 8 === bytes.length &&
      bytes.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16)) &&
      bytes.readUInt32LE(16) > 0 && bytes.readUInt32LE(16) <= bytes.length - 20;
  if (!valid || bytes.toString('base64') !== encoded) throw Error('wiki_host_cover_invalid');
  return { mime, bytes };
}

function checkOwner(owner: WikiHostOwner) {
  if (!isId(owner.projectId) || !isId(owner.profileId)) throw Error('wiki_host_owner_invalid');
}

function checkChange(input: WikiHostChange) {
  checkOwner(input);
  if (typeof input.slug !== 'string' || !WIKI_HOST_SLUG.test(input.slug)) throw Error('wiki_host_slug_invalid');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw Error('wiki_host_revision_invalid');
}

function wikiOrigin(options: WikiReaderOptions) {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw Error('wiki_host_port_invalid');
  const publicUrl = options.publicOrigin ? new URL(options.publicOrigin) : null;
  if (publicUrl && (!['https:', 'http:'].includes(publicUrl.protocol) || publicUrl.href !== publicUrl.origin + '/')) {
    throw Error('wiki_host_origin_invalid');
  }
  return publicUrl;
}

function checkReadOwner(owner: ReadHostOwner) {
  if (!isId(owner.projectId) || !isId(owner.ownerKey)) throw Error('wiki_host_owner_invalid');
}

function checkReadChange(input: ReadHostChange) {
  checkReadOwner(input);
  if (typeof input.slug !== 'string' || !WIKI_HOST_SLUG.test(input.slug)) throw Error('wiki_host_slug_invalid');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw Error('wiki_host_revision_invalid');
}

const loopbackOrigin = (port: number) => `http://${BIND}:${port}`;
/** Registry key → public path: wiki rows keep their bare slug, reading rows are prefixed. */
const addressPath = (key: string) => key.startsWith(READ_HOST_KEY_PREFIX)
  ? '/read/' + key.slice(READ_HOST_KEY_PREFIX.length) : '/wiki/' + key;
const wikiAddressUrl = (row: AddressRow, base: string | undefined) =>
  row.active && base ? base + addressPath(row.slug) + (row.token ? '/u/' + row.token : '') : null;

function createWikiReader(options: WikiReaderOptions, publicUrl: URL | null, find: (slug: string) => Row | undefined) {
  let origin: string | undefined;
  let starting: Promise<void> | undefined;

  function serve(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const local = origin && new URL(origin);
    if (!local || !req.headers.host || ![local.host, 'localhost:' + local.port, publicUrl?.host].includes(req.headers.host)) {
      res.writeHead(421).end();
      return;
    }
    const [prefix, section, slug, ...suffix] = (req.url ?? '').split('?')[0].split('/');
    const coverRequest = suffix.at(-1) === 'cover';
    if (coverRequest) suffix.pop();
    const token = suffix[1];
    const reading = section === 'read';
    if (prefix !== '' || (section !== 'wiki' && !reading) || !WIKI_HOST_SLUG.test(slug ?? '') ||
      (reading && coverRequest) ||
      (suffix.length !== 0 && (suffix.length !== 2 || suffix[0] !== 'u' || !TOKEN.test(token ?? '')))) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const row = find(reading ? READ_HOST_KEY_PREFIX + slug : slug);
    if (!row?.active || (row.token ?? undefined) !== token) {
      res.writeHead(404).end();
      return;
    }
    if (row.token) res.setHeader('X-Robots-Tag', 'noindex');
    if (coverRequest) {
      if (!row.cover) { res.writeHead(404).end(); return; }
      const { mime, bytes } = decodeCover(row.cover);
      res.writeHead(200, {
        'Content-Type': mime, 'Content-Length': bytes.length, ETag: '"' + hash(bytes) + '"',
      }).end(req.method === 'HEAD' ? undefined : bytes);
      return;
    }
    if (hash(row.html) !== row.sha256) {
      res.writeHead(500).end();
      return;
    }
    const coverUrl = row.cover && wikiAddressUrl(row, publicUrl?.origin ?? origin);
    const meta = coverUrl ? `<meta property="og:image" content="${coverUrl}/cover">` : '';
    const html = meta ? row.html.replace(/<\/head>|^<!doctype html>(?![\s\S]*<\/head>)/i,
      tag => tag.toLowerCase() === '</head>' ? meta + tag : tag + meta) : row.html;
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Content-Security-Policy': "frame-ancestors 'none'",
      ETag: '"' + (meta ? hash(html) : row.sha256) + '"',
    }).end(req.method === 'HEAD' ? undefined : html);
  }

  const server = createServer((req, res) => {
    try { serve(req, res); }
    catch (error) {
      const sqliteCode = (error as { errcode?: number }).errcode;
      res.writeHead(sqliteCode === 5 || sqliteCode === 6 ? 503 : 500).end();
    }
  });
  function start() {
    return starting ??= new Promise<void>((resolve, reject) => {
      function failed(error: Error) { starting = undefined; reject(error); }
      server.once('error', failed);
      server.listen(options.port, BIND, () => {
        server.off('error', failed);
        const address = server.address();
        if (!address || typeof address === 'string') throw Error('wiki_host_listener_invalid');
        origin = loopbackOrigin(address.port);
        resolve();
      });
    });
  }

  return {
    start,
    origin: () => origin,
    async close() {
      try {
        await starting?.catch(() => undefined);
        if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
      } finally {
        starting = undefined;
        origin = undefined;
      }
    },
  };
}

/** This process owns only the reader socket. The editor owns registry creation and writes. */
export function createStandaloneWikiReader(options: WikiReaderOptions & { file: string }) {
  const publicUrl = wikiOrigin(options);
  if (!options.port) throw Error('wiki_host_port_invalid');
  return createWikiReader(options, publicUrl, slug => {
    if (!statSync(options.file, { throwIfNoEntry: false })) return undefined;
    const db = new DatabaseSync(options.file, { readOnly: true, timeout: 150 });
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='wiki_addresses'").get()) return undefined;
      return db.prepare('SELECT * FROM wiki_addresses WHERE slug=?').get(slug) as Row | undefined;
    } finally { db.close(); }
  });
}

export function createWikiHost(options: WikiReaderOptions & { file: string; externalReader?: boolean }) {
  const publicUrl = wikiOrigin(options);
  if (options.externalReader && !options.port) throw Error('wiki_host_port_invalid');
  const reader = options.externalReader ? undefined : createWikiReader(options, publicUrl, find);
  let db: DatabaseSync | undefined;

  function store() {
    if (db) return db;
    mkdirSync(path.dirname(options.file), { recursive: true });
    const opened = new DatabaseSync(options.file);
    try {
      opened.exec(`
        PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS wiki_addresses (
          slug TEXT PRIMARY KEY, projectId TEXT NOT NULL, profileId TEXT NOT NULL,
          editionId TEXT NOT NULL, audience TEXT NOT NULL, sha256 TEXT NOT NULL,
          revision INTEGER NOT NULL, active INTEGER NOT NULL, token TEXT, html TEXT NOT NULL
        );
      `);
      if (!opened.prepare('PRAGMA table_info(wiki_addresses)').all().some(column => column.name === 'cover')) {
        opened.exec('ALTER TABLE wiki_addresses ADD COLUMN cover TEXT');
      }
      db = opened;
      return db;
    } catch (error) {
      opened.close();
      throw error;
    }
  }

  function find(slug: string): Row | undefined {
    return store().prepare('SELECT * FROM wiki_addresses WHERE slug=?').get(slug) as Row | undefined;
  }

  function summary(row: AddressRow & { hasCover: number }): WikiHostAddress {
    const url = wikiAddressUrl(row, publicUrl?.origin ?? (options.externalReader ? loopbackOrigin(options.port) : reader?.origin()));
    return {
      projectId: row.projectId, profileId: row.profileId, slug: row.slug, editionId: row.editionId,
      sha256: row.sha256, audience: row.audience, revision: row.revision, active: !!row.active,
      url, ...(url && row.hasCover ? { coverUrl: url + '/cover' } : {}),
    };
  }

  function readSummary(row: AddressRow): ReadHostAddress {
    const url = wikiAddressUrl(row, publicUrl?.origin ?? (options.externalReader ? loopbackOrigin(options.port) : reader?.origin()));
    return {
      kind: 'manuscript-edition', projectId: row.projectId, ownerKey: row.profileId,
      slug: row.slug.slice(READ_HOST_KEY_PREFIX.length), editionId: row.editionId,
      sha256: row.sha256, audience: row.audience, revision: row.revision, active: !!row.active, url,
    };
  }

  return {
    async resume() {
      if (!reader || (!db && !existsSync(options.file))) return;
      if (store().prepare('SELECT 1 FROM wiki_addresses LIMIT 1').get()) await reader.start();
    },
    list(owner: WikiHostListScope) {
      if ((owner.projectId !== undefined && !isId(owner.projectId)) ||
        (owner.profileId !== undefined && (!isId(owner.profileId) || owner.projectId === undefined))) throw Error('wiki_host_owner_invalid');
      const project = owner.projectId ?? null;
      const profile = owner.profileId ?? null;
      // Reading-address keys contain ':' (READ_HOST_KEY_PREFIX); wiki slugs never do.
      const rows = store().prepare(`SELECT ${ADDRESS_COLUMNS} FROM wiki_addresses WHERE instr(slug, ':')=0 AND (? IS NULL OR projectId=?) AND (? IS NULL OR profileId=?) ORDER BY slug`).all(project, project, profile, profile);
      return (rows as (AddressRow & { hasCover: number })[]).map(summary);
    },
    async publish(input: WikiHostPublication) {
      checkChange(input);
      if (!isId(input.editionId) || !['public', 'unlisted'].includes(input.audience) ||
        typeof input.html !== 'string' || !/^<!doctype html>/i.test(input.html) || hash(input.html) !== input.sha256) {
        throw Error('wiki_host_artifact_changed');
      }
      if (input.coverImage !== undefined && input.coverImage !== null) decodeCover(input.coverImage);
      await reader?.start();
      const token = input.audience === 'unlisted' ? randomBytes(24).toString('base64url') : null;
      const sql = `
        INSERT INTO wiki_addresses (slug, projectId, profileId, editionId, audience, sha256, revision, active, token, html, cover)
        SELECT ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?
        WHERE ?=0 OR EXISTS(SELECT 1 FROM wiki_addresses WHERE slug=?)
        ON CONFLICT(slug) DO UPDATE SET editionId=excluded.editionId, audience=excluded.audience,
          sha256=excluded.sha256, revision=wiki_addresses.revision+1, active=1,
          token=CASE WHEN wiki_addresses.audience=excluded.audience THEN wiki_addresses.token ELSE excluded.token END,
          html=excluded.html, cover=CASE WHEN ? THEN excluded.cover ELSE wiki_addresses.cover END
        WHERE wiki_addresses.projectId=excluded.projectId AND wiki_addresses.profileId=excluded.profileId
          AND wiki_addresses.revision=?
        RETURNING ${ADDRESS_COLUMNS}
      `;
      const row = store().prepare(sql).get(input.slug, input.projectId, input.profileId, input.editionId, input.audience,
        input.sha256, token, input.html, input.coverImage ?? null, input.expectedRevision, input.slug,
        Number(input.coverImage !== undefined), input.expectedRevision);
      if (!row) throw Error('wiki_host_conflict');
      return summary(row as AddressRow & { hasCover: number });
    },
    withdraw(input: WikiHostChange) {
      checkChange(input);
      const row = store().prepare(`
        UPDATE wiki_addresses SET active=0, revision=revision+1 WHERE slug=? AND projectId=? AND profileId=? AND revision=? AND active=1
        RETURNING ${ADDRESS_COLUMNS}
      `).get(input.slug, input.projectId, input.profileId, input.expectedRevision);
      if (!row) throw Error('wiki_host_conflict');
      return summary(row as AddressRow & { hasCover: number });
    },
    /** Manuscript editions under `/read/<slug>`: same registry, CAS, tokens and reader. */
    readList(owner: ReadHostListScope) {
      if ((owner.projectId !== undefined && !isId(owner.projectId)) ||
        (owner.ownerKey !== undefined && (!isId(owner.ownerKey) || owner.projectId === undefined))) throw Error('wiki_host_owner_invalid');
      const project = owner.projectId ?? null;
      const key = owner.ownerKey ?? null;
      const rows = store().prepare(`SELECT ${ADDRESS_COLUMNS} FROM wiki_addresses WHERE substr(slug, 1, ?)=? AND (? IS NULL OR projectId=?) AND (? IS NULL OR profileId=?) ORDER BY slug`)
        .all(READ_HOST_KEY_PREFIX.length, READ_HOST_KEY_PREFIX, project, project, key, key);
      return (rows as (AddressRow & { hasCover: number })[]).map(readSummary);
    },
    async readPublish(input: ReadHostPublication) {
      checkReadChange(input);
      if (!isId(input.editionId) || !['public', 'unlisted'].includes(input.audience) ||
        typeof input.html !== 'string' || !/^<!doctype html>/i.test(input.html) || hash(input.html) !== input.sha256) {
        throw Error('wiki_host_artifact_changed');
      }
      await reader?.start();
      const key = READ_HOST_KEY_PREFIX + input.slug;
      const token = input.audience === 'unlisted' ? randomBytes(24).toString('base64url') : null;
      const row = store().prepare(`
        INSERT INTO wiki_addresses (slug, projectId, profileId, editionId, audience, sha256, revision, active, token, html, cover)
        SELECT ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, NULL
        WHERE ?=0 OR EXISTS(SELECT 1 FROM wiki_addresses WHERE slug=?)
        ON CONFLICT(slug) DO UPDATE SET editionId=excluded.editionId, audience=excluded.audience,
          sha256=excluded.sha256, revision=wiki_addresses.revision+1, active=1,
          token=CASE WHEN wiki_addresses.audience=excluded.audience THEN wiki_addresses.token ELSE excluded.token END,
          html=excluded.html
        WHERE wiki_addresses.projectId=excluded.projectId AND wiki_addresses.profileId=excluded.profileId
          AND wiki_addresses.revision=?
        RETURNING ${ADDRESS_COLUMNS}
      `).get(key, input.projectId, input.ownerKey, input.editionId, input.audience, input.sha256, token, input.html,
        input.expectedRevision, key, input.expectedRevision);
      if (!row) throw Error('wiki_host_conflict');
      return readSummary(row as AddressRow & { hasCover: number });
    },
    readWithdraw(input: ReadHostChange) {
      checkReadChange(input);
      const row = store().prepare(`
        UPDATE wiki_addresses SET active=0, revision=revision+1 WHERE slug=? AND projectId=? AND profileId=? AND revision=? AND active=1
        RETURNING ${ADDRESS_COLUMNS}
      `).get(READ_HOST_KEY_PREFIX + input.slug, input.projectId, input.ownerKey, input.expectedRevision);
      if (!row) throw Error('wiki_host_conflict');
      return readSummary(row as AddressRow & { hasCover: number });
    },
    async close() {
      try {
        await reader?.close();
      } finally {
        db?.close();
        db = undefined;
      }
    },
  };
}
