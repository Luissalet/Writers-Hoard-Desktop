import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const warnings = [];

// Ratchet any consciously accepted backup debt without allowing new omissions.
// Keep this empty unless a migration must land before its backup implementation.
const KNOWN_BACKUP_GAPS = new Map();

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function quotedStrings(source) {
  return Array.from(source.matchAll(/'((?:\\.|[^'])*)'/g), (match) =>
    match[1].replaceAll("\\'", "'"),
  );
}

function localeKeys(source) {
  return Array.from(source.matchAll(/^\s*'((?:\\.|[^'])+)'\s*:/gm), (match) =>
    match[1].replaceAll("\\'", "'"),
  );
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return Array.from(duplicates);
}

const packageJson = JSON.parse(read('package.json'));
const desktopCommand = packageJson.scripts?.['dev:desktop'];
if (desktopCommand !== 'node scripts/dev-desktop.mjs') {
  fail('dev:desktop must use the coordinated desktop launcher.');
}
const desktopLauncher = read('scripts/dev-desktop.mjs');
if (!desktopLauncher.includes('server.resolvedUrls')) {
  fail('Desktop launcher must consume Vite resolvedUrls.');
}
if (!desktopLauncher.includes('ELECTRON_RENDERER_URL: rendererUrl')) {
  fail('Desktop launcher must pass Vite’s resolved URL to Electron.');
}
if (/ELECTRON_RENDERER_URL=[^\s"]*:\d+/.test(desktopCommand ?? '')) {
  fail('dev:desktop must not hard-code the Electron renderer port.');
}

function canonicalIndexSpec(spec) {
  const parts = spec.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return parts.join(',');
  return [parts[0], ...parts.slice(1).sort()].join(',');
}

function parseStoresBlocks(dbSource) {
  const blocks = [];
  const marker = /this\.version\((\d+)\)\.stores\(\{/g;
  let match;

  while ((match = marker.exec(dbSource)) !== null) {
    const openBrace = marker.lastIndex - 1;
    let depth = 0;
    let quote = null;
    let escaped = false;
    let closeBrace = -1;

    for (let index = openBrace; index < dbSource.length; index += 1) {
      const char = dbSource[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          closeBrace = index;
          break;
        }
      }
    }

    if (closeBrace < 0) {
      fail(`Could not parse Dexie stores block for version ${match[1]}.`);
      continue;
    }
    blocks.push({
      version: Number(match[1]),
      body: dbSource.slice(openBrace + 1, closeBrace),
    });
    marker.lastIndex = closeBrace + 1;
  }

  return blocks.sort((left, right) => left.version - right.version);
}

function effectiveDexieSchema(dbSource) {
  const schema = new Map();
  for (const { version, body } of parseStoresBlocks(dbSource)) {
    const entry = /^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:'([^']*)'|null)\s*,?/gm;
    let match;
    while ((match = entry.exec(body)) !== null) {
      if (match[2] === undefined) schema.delete(match[1]);
      else schema.set(match[1], { spec: match[2], version });
    }
  }
  return schema;
}

function parseEngine(directory, source) {
  const lazyUse = source.indexOf('lazy(');
  if (lazyUse >= 0) {
    const lazyImport = source.indexOf("import { lazy } from 'react';");
    if (lazyImport < 0 || lazyImport > lazyUse) {
      fail(`${directory}: React lazy must be imported before its first use.`);
    }
  }

  const definition = source.match(
    /const\s+([A-Za-z_$][\w$]*Engine)\s*:\s*EngineDefinition\s*=\s*\{([\s\S]*?)\n\};/,
  );
  if (!definition) {
    fail(`${directory}: no statically readable EngineDefinition found.`);
    return null;
  }

  const variable = definition[1];
  const body = definition[2];
  const id = body.match(/^\s*id:\s*'([^']+)'/m)?.[1];
  const tableBody = body.match(/^\s*tables:\s*\{([\s\S]*?)^\s*\},?/m)?.[1] ?? '';
  const tables = new Map();
  const tableEntry = /^\s*([A-Za-z_$][\w$]*)\s*:\s*'([^']*)'/gm;
  let tableMatch;
  while ((tableMatch = tableEntry.exec(tableBody)) !== null) {
    tables.set(tableMatch[1], tableMatch[2]);
  }

  if (!id) fail(`${directory}: EngineDefinition is missing a literal id.`);
  if (id && id !== directory) {
    fail(`${directory}: engine id "${id}" must match its directory.`);
  }
  if (!source.includes(`registerEngine(${variable})`)) {
    fail(`${directory}: ${variable} is not passed to registerEngine().`);
  }

  const backupStart = source.indexOf('registerBackupStrategy(');
  let backup = null;
  if (backupStart >= 0) {
    const backupSource = source.slice(backupStart);
    const backupId = backupSource.match(/\bengineId:\s*'([^']+)'/)?.[1];
    const backupTablesSource = backupSource.match(/\btables:\s*\[([^\]]*)\]/)?.[1] ?? '';
    const backupTables = new Set(quotedStrings(backupTablesSource));
    const constArrays = new Map(
      Array.from(
        source.matchAll(
          /const\s+([A-Za-z_$][\w$]*)\s*=\s*\[([\s\S]*?)\]\s+as const\s*;/g,
        ),
        (match) => [match[1], quotedStrings(match[2])],
      ),
    );
    for (const spread of backupTablesSource.matchAll(/\.\.\.([A-Za-z_$][\w$]*)/g)) {
      const values = constArrays.get(spread[1]);
      if (!values) {
        fail(`${directory}: backup tables spread "${spread[1]}" is not statically readable.`);
        continue;
      }
      for (const value of values) backupTables.add(value);
    }
    backup = {
      engineId: backupId,
      tables: backupTables,
    };
  }

  return { directory, id, tables, backup };
}

const engineRoot = path.join(ROOT, 'src', 'engines');
const engineBootstrap = read('src/engines/index.ts');
const importedDirectories = new Set(
  Array.from(
    engineBootstrap.matchAll(/import\s+['"]@\/engines\/([^'"]+)['"];/g),
    (match) => match[1],
  ),
);
const engineDirectories = readdirSync(engineRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .filter((entry) => {
    try {
      read(`src/engines/${entry.name}/index.ts`);
      return true;
    } catch {
      return false;
    }
  })
  .map((entry) => entry.name)
  .sort();

for (const directory of engineDirectories) {
  if (!importedDirectories.has(directory)) {
    fail(`${directory}: engine index exists but is not imported by src/engines/index.ts.`);
  }
}
for (const directory of importedDirectories) {
  if (!engineDirectories.includes(directory)) {
    fail(`${directory}: bootstrapped engine has no src/engines/${directory}/index.ts.`);
  }
}

const engines = engineDirectories
  .map((directory) => parseEngine(directory, read(`src/engines/${directory}/index.ts`)))
  .filter(Boolean);
const ids = engines.map((engine) => engine.id).filter(Boolean);
for (const duplicate of duplicateValues(ids)) {
  fail(`Duplicate engine id: ${duplicate}.`);
}
const engineIds = new Set(ids);

const dbSource = read('src/db/index.ts');
const dexieSchema = effectiveDexieSchema(dbSource);
const typedTables = new Set(
  Array.from(dbSource.matchAll(/^\s*([A-Za-z_$][\w$]*)!\s*:\s*Table</gm), (match) => match[1]),
);
const tableOwners = new Map();

for (const engine of engines) {
  for (const [table, declaredSpec] of engine.tables) {
    const existingOwner = tableOwners.get(table);
    if (existingOwner) {
      fail(`${engine.id}: table "${table}" is already owned by ${existingOwner}.`);
    } else {
      tableOwners.set(table, engine.id);
    }

    const schemaEntry = dexieSchema.get(table);
    if (!schemaEntry) {
      fail(`${engine.id}: table "${table}" is absent from the effective Dexie schema.`);
    } else if (canonicalIndexSpec(schemaEntry.spec) !== canonicalIndexSpec(declaredSpec)) {
      fail(
        `${engine.id}: table "${table}" declares "${declaredSpec}" but Dexie v${schemaEntry.version} uses "${schemaEntry.spec}".`,
      );
    }
    if (!typedTables.has(table)) {
      fail(`${engine.id}: table "${table}" has no typed Table<> property on WritersHoardDB.`);
    }
  }

  if (engine.tables.size === 0) {
    if (engine.backup) fail(`${engine.id}: tableless engine should not register a backup strategy.`);
    continue;
  }
  if (!engine.backup) {
    fail(`${engine.id}: persisted engine has no statically readable backup strategy.`);
    continue;
  }
  if (engine.backup.engineId !== engine.id) {
    fail(`${engine.id}: backup strategy declares engineId "${engine.backup.engineId ?? 'missing'}".`);
  }

  for (const table of engine.backup.tables) {
    if (!engine.tables.has(table)) {
      fail(`${engine.id}: backup strategy lists unowned table "${table}".`);
    }
    if (!dexieSchema.has(table)) {
      fail(`${engine.id}: backup strategy lists missing Dexie table "${table}".`);
    }
  }

  const knownGaps = KNOWN_BACKUP_GAPS.get(engine.id) ?? new Set();
  for (const table of engine.tables.keys()) {
    if (engine.backup.tables.has(table)) {
      if (knownGaps.has(table)) {
        fail(`${engine.id}: "${table}" is now backed up; remove its stale known-gap entry.`);
      }
      continue;
    }
    if (knownGaps.has(table)) {
      warn(`${engine.id}: known backup gap remains for "${table}".`);
    } else {
      fail(`${engine.id}: table "${table}" is not declared by its backup strategy.`);
    }
  }
  for (const table of knownGaps) {
    if (!engine.tables.has(table)) {
      fail(`${engine.id}: stale known-gap table "${table}" is no longer engine-owned.`);
    }
  }
}

const registrySource = read('src/engines/_registry.ts');
for (const match of registrySource.matchAll(
  /\b(defaultEngines|suggestedEngines):\s*\[([^\]]*)\]/g,
)) {
  const listName = match[1];
  const listedIds = quotedStrings(match[2]);
  for (const duplicate of duplicateValues(listedIds)) {
    fail(`Project mode ${listName} contains duplicate engine "${duplicate}".`);
  }
  for (const engineId of listedIds) {
    if (!engineIds.has(engineId)) {
      fail(`Project mode ${listName} references unknown engine "${engineId}".`);
    }
  }
}

const locales = new Map([
  ['en', localeKeys(read('src/locales/en.ts'))],
  ['es', localeKeys(read('src/locales/es.ts'))],
]);
for (const [locale, keys] of locales) {
  for (const duplicate of duplicateValues(keys)) {
    fail(`${locale} locale contains duplicate key "${duplicate}".`);
  }
}
const enKeys = new Set(locales.get('en'));
const esKeys = new Set(locales.get('es'));
for (const key of enKeys) {
  if (!esKeys.has(key)) fail(`Spanish locale is missing "${key}".`);
}
for (const key of esKeys) {
  if (!enKeys.has(key)) fail(`English locale is missing "${key}".`);
}
for (const engineId of engineIds) {
  for (const suffix of ['name', 'description']) {
    const key = `engines.${engineId}.${suffix}`;
    if (!enKeys.has(key)) fail(`English locale is missing engine key "${key}".`);
    if (!esKeys.has(key)) fail(`Spanish locale is missing engine key "${key}".`);
  }
}

const binaryManifest = JSON.parse(read('scripts/binary-manifest.json'));
for (const binaryId of ['yt-dlp', 'gallery-dl']) {
  const binary = binaryManifest.binaries?.[binaryId];
  if (!binary) {
    fail(`Binary manifest is missing "${binaryId}".`);
    continue;
  }
  if (!binary.repository || !binary.version || !binary.envPrefix) {
    fail(`${binaryId}: manifest requires repository, version, and envPrefix.`);
  }
  for (const platform of ['win32', 'darwin', 'linux']) {
    if (!binary.assets?.[platform] || !binary.localNames?.[platform]) {
      fail(`${binaryId}: manifest is missing ${platform} asset/local name.`);
    }
    const checksum = binary.sha256?.[platform];
    if (!checksum) {
      fail(`${binaryId}: ${platform} SHA-256 must be pinned.`);
    } else if (!/^[a-f0-9]{64}$/i.test(checksum)) {
      fail(`${binaryId}: ${platform} SHA-256 must be 64 hexadecimal characters.`);
    }
  }
  if (binary.version === 'latest') {
    fail(`${binaryId}: version must be immutable; "latest" is not release-safe.`);
  }
}

for (const message of warnings) console.warn(`WARN  ${message}`);
for (const message of failures) console.error(`ERROR ${message}`);

if (failures.length > 0) {
  console.error(
    `\nConformance failed: ${failures.length} error(s), ${warnings.length} warning(s).`,
  );
  process.exit(1);
}

console.log(
  `Conformance passed: ${engines.length} engines, ${tableOwners.size} engine tables, ` +
    `${enKeys.size} locale keys (${warnings.length} known warning(s)).`,
);
