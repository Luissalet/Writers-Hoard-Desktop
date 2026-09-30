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
  const numericConstants = new Map(
    Array.from(
      dbSource.matchAll(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+)\s*;/gm),
      (constant) => [constant[1], Number(constant[2])],
    ),
  );
  const marker = /this\.version\((\d+|[A-Za-z_$][\w$]*)\)\.stores\(\{/g;
  let match;

  while ((match = marker.exec(dbSource)) !== null) {
    const version = /^\d+$/.test(match[1])
      ? Number(match[1])
      : numericConstants.get(match[1]);
    if (version === undefined) {
      fail(`Could not resolve Dexie version constant "${match[1]}".`);
      continue;
    }
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
      version,
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
// An engine may ship its own copy in `src/engines/<id>/locales/{en,es}.ts`,
// registered when its chunk loads. Those keys count as defined, must keep
// es/en parity like the main files, and may not repeat a main key (the main
// file would win silently).
const mainKeyCount = new Map([...locales].map(([locale, keys]) => [locale, new Set(keys)]));
let engineLocaleFiles = 0;
for (const entry of readdirSync(path.join(ROOT, 'src/engines'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  for (const locale of ['en', 'es']) {
    let source;
    try { source = read(`src/engines/${entry.name}/locales/${locale}.ts`); } catch { continue; }
    engineLocaleFiles += 1;
    for (const key of localeKeys(source)) {
      if (mainKeyCount.get(locale).has(key)) fail(`src/engines/${entry.name}/locales/${locale}.ts repeats main locale key "${key}".`);
      locales.get(locale).push(key);
    }
  }
}
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

/**
 * Toda clave que el código PIDE tiene que existir.
 *
 * La paridad es/en de arriba sólo compara los dos ficheros entre sí: si una
 * clave no está en NINGUNO de los dos, los dos están igual de incompletos y la
 * comprobación pasaba. Y `t()` devuelve la clave cuando no la encuentra, así
 * que el fallo no es una excepción sino texto de programador en la cara del
 * lector. Medido al escribir esta guarda: de 1 395 claves literales pedidas en
 * `src/`, 5 no existían — las tres del localizador (su caja de búsqueda decía
 * «worldgen.locator.placeholder»), la del botón de ayuda del 2D y una del
 * selector de iconos. Ninguna había fallado nunca en ningún banco.
 *
 * Sólo se miran las claves LITERALES: una clave compuesta (`t(`x.${kind}`)`)
 * no se puede resolver leyendo el fichero, y exigirla aquí sería pedirle a
 * esta comprobación que ejecute la aplicación.
 */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'locales') continue;
      out.push(...sourceFiles(rel));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}
const missingKeys = new Map();
for (const file of sourceFiles('src')) {
  const src = read(file);
  // `t` no siempre se llama `t`: `World3D.tsx` la importa como `translate`
  // porque ya tiene una `t` del hook dentro del componente, y buscar sólo
  // `t(` dejaba fuera 288 de las 1 683 llamadas literales de `src/` — el 17 %,
  // y justo el 17 % que dibuja el HUD del 3D. El nombre local se lee del
  // PROPIO import en vez de mantener una lista de alias aquí, que es la clase
  // de lista que se queda vieja sin que nadie se entere.
  const names = new Set(['t']);
  for (const imported of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const alias of imported[1].matchAll(/\bt\s+as\s+(\w+)/g)) names.add(alias[1]);
  }
  const calls = new RegExp(`\\b(?:${[...names].join('|')})\\(\\s*'((?:\\\\.|[^'])+)'\\s*\\)`, 'g');
  for (const match of src.matchAll(calls)) {
    const key = match[1].replaceAll("\\'", "'");
    if (enKeys.has(key) && esKeys.has(key)) continue;
    if (!missingKeys.has(key)) missingKeys.set(key, file);
  }
}
for (const [key, file] of missingKeys) {
  fail(`${file} asks for locale key "${key}", which no locale defines.`);
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

// ---------------------------------------------------------------------------
// worldgen: the 2D map must ask for the geography it draws
// ---------------------------------------------------------------------------
// This one is a scar. The road layer was written, measured against
// `buildHumanGeography(..., 'full')` in a bench, and shipped — and drew nothing
// at all, because `WorldView` asked for depth `'places'`, where `roads` is the
// empty array. The renderer was right and the view starved it. Same for the
// named seas, the ranges and the ruins. Verifying a renderer is not verifying
// a view, and nothing about the failure was visible in either file alone.
{
  const worldView = read('src/engines/worldgen/components/WorldView.tsx');
  const needsFull = worldView.match(/const needsFullGeo = ([^;]+);/s);
  if (!needsFull) {
    fail('worldgen: needsFullGeo not found in WorldView — the 2D geography depth guard cannot be checked.');
  } else if (!needsFull[1].includes("view === 'map'")) {
    fail(
      'worldgen: the 2D map must be in needsFullGeo, or geography.roads/features/ruins '
      + 'are empty arrays and the road, name and ruin layers silently draw nothing.',
    );
  }
  const map2d = read('src/engines/worldgen/components/Map2D.tsx');
  if (!map2d.includes('painted.current = hits')) {
    fail(
      'worldgen: Map2D must publish what it drew into `painted` — the hit-tests read that '
      + 'list, and walking the model instead is how clicking open ocean opened a town.',
    );
  }
}

// ---------------------------------------------------------------------------
// electron: every IPC channel a handler answers must have a declared role
// ---------------------------------------------------------------------------
// `assertIpcSender` fails closed: a channel missing from IPC_CHANNEL_ROLES is
// refused for every window, which in practice means a handler that was
// wired, typed and tested still answers "Forbidden IPC sender" at runtime
// (docs/AI-BRIDGE.md §9). Reading both files here catches it before the app
// does. Only literal channel names are checked — a computed channel would
// need the app running to resolve.
{
  const security = read('electron/security.ts');
  const rolesBlock = security.match(/const IPC_CHANNEL_ROLES[^{]*\{([\s\S]*?)\n\}\);/);
  if (!rolesBlock) {
    fail('electron: IPC_CHANNEL_ROLES not found in electron/security.ts.');
  } else {
    const declared = new Set([...rolesBlock[1].matchAll(/^\s*'([^']+)'\s*:/gm)].map((m) => m[1]));
    const handled = new Map();
    for (const file of sourceFiles('electron')) {
      const source = read(file);
      for (const match of source.matchAll(/ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)) {
        if (!handled.has(match[1])) handled.set(match[1], file);
      }
    }
    for (const [channel, file] of handled) {
      if (!declared.has(channel)) {
        fail(`electron: ${file} handles IPC channel "${channel}" but electron/security.ts declares no role for it — every sender would be refused.`);
      }
    }
    if (handled.size === 0) fail('electron: no ipcMain handlers found — the IPC scan is broken.');
  }
}

// ---------------------------------------------------------------------------
// interface: critical dark-theme text tokens must remain readable
// ---------------------------------------------------------------------------
{
  const css = read('src/index.css');
  const token = (name) => css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((part) => Number.parseInt(part, 16) / 255);
    const linear = channels.map((channel) => (
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    ));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const ratio = (left, right) => {
    const a = luminance(left);
    const b = luminance(right);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const foregrounds = ['text-primary', 'text-muted', 'text-dim'];
  const backgrounds = ['deep', 'surface', 'elevated'];
  for (const foregroundName of foregrounds) {
    const foreground = token(foregroundName);
    if (!foreground) {
      fail(`interface: --color-${foregroundName} is missing or not a six-digit hex colour.`);
      continue;
    }
    for (const backgroundName of backgrounds) {
      const background = token(backgroundName);
      if (!background) {
        fail(`interface: --color-${backgroundName} is missing or not a six-digit hex colour.`);
        continue;
      }
      const contrast = ratio(foreground, background);
      if (contrast < 4.5) {
        fail(
          `interface: ${foregroundName} on ${backgroundName} is ${contrast.toFixed(2)}:1; `
          + 'normal text requires at least 4.5:1.',
        );
      }
    }
  }
  if (!css.includes('color-scheme: dark')) {
    fail('interface: the dark theme must declare `color-scheme: dark` for native controls.');
  }
  if (!css.includes('@media (prefers-reduced-motion: reduce)')) {
    fail('interface: the system reduced-motion preference is not handled.');
  }
  const html = read('index.html');
  if (!/<meta\s+name="theme-color"\s+content="#[0-9a-f]{6}"/i.test(html)) {
    fail('interface: index.html has no explicit dark theme-color.');
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
    `${enKeys.size} locale keys, ${engineLocaleFiles} engine locale file(s) (${warnings.length} known warning(s)).`,
);
