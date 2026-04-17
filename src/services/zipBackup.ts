import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { db } from '@/db/index';
import { getAllBackupStrategies } from '@/engines/_shared/backupRegistry';
// Engine barrel import guarantees every engine has registered its backup
// strategy before export/import run. Without this import the registry would
// be empty when backup is triggered from a screen that hasn't touched engines.
import '@/engines';

// ============================================
// Structured ZIP Backup — Export & Import
// ============================================

// Helpers: base64 data URL → binary
function dataUrlToBlob(dataUrl: string): { blob: Uint8Array; ext: string; mime: string } {
  const match = dataUrl.match(/^data:(image\/(\w+));base64,(.+)$/);
  if (!match) return { blob: new Uint8Array(), ext: 'bin', mime: 'application/octet-stream' };
  const mime = match[1];
  let ext = match[2];
  if (ext === 'jpeg') ext = 'jpg';
  const binary = atob(match[3]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: bytes, ext, mime };
}

// Sanitize filename
function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, ' ').trim() || 'untitled';
}

// ============================================
// EXPORT
// ============================================
export async function exportFullZip(): Promise<void> {
  const zip = new JSZip();

  // Gather all data
  const [projects, codexEntries, writings, timelines, timelineEvents,
    yarnBoards, yarnNodes, yarnEdges, worldMaps, mapPins,
    imageCollections, inspirationImages, externalLinks, tags, settings,
  ] = await Promise.all([
    db.projects.toArray(),
    db.codexEntries.toArray(),
    db.writings.toArray(),
    db.timelines.toArray(),
    db.timelineEvents.toArray(),
    db.yarnBoards.toArray(),
    db.yarnNodes.toArray(),
    db.yarnEdges.toArray(),
    db.worldMaps.toArray(),
    db.mapPins.toArray(),
    db.imageCollections.toArray(),
    db.inspirationImages.toArray(),
    db.externalLinks.toArray(),
    db.tags.toArray(),
    db.settings.toArray(),
  ]);

  // --- manifest.json (top level) ---
  zip.file('manifest.json', JSON.stringify({
    app: 'WritersHoard',
    version: 2,
    exportedAt: new Date().toISOString(),
    projectCount: projects.length,
  }, null, 2));

  // --- Global settings & tags ---
  zip.file('settings.json', JSON.stringify(settings, null, 2));
  zip.file('tags.json', JSON.stringify(tags, null, 2));

  // --- Per-project folders ---
  for (const project of projects) {
    const projName = sanitize(project.title);
    const projDir = `projects/${projName}__${project.id}`;

    // Project metadata (without coverImage binary)
    const projMeta = { ...project };
    if (projMeta.coverImage) {
      const { blob, ext } = dataUrlToBlob(projMeta.coverImage);
      zip.file(`${projDir}/cover.${ext}`, blob);
      (projMeta as Record<string, unknown>).coverImage = `cover.${ext}`;
    }
    zip.file(`${projDir}/project.json`, JSON.stringify(projMeta, null, 2));

    // ---- Codex ----
    const projCodex = codexEntries.filter(e => e.projectId === project.id);
    if (projCodex.length > 0) {
      for (const entry of projCodex) {
        const entryName = sanitize(entry.title);
        const entryDir = `${projDir}/codex/${entryName}__${entry.id}`;
        const entryMeta = { ...entry };

        // Extract avatar to file
        if (entryMeta.avatar) {
          const { blob, ext } = dataUrlToBlob(entryMeta.avatar);
          zip.file(`${entryDir}/avatar.${ext}`, blob);
          (entryMeta as Record<string, unknown>).avatar = `avatar.${ext}`;
        }

        zip.file(`${entryDir}/entry.json`, JSON.stringify(entryMeta, null, 2));
      }
    }

    // ---- Writings ----
    const projWritings = writings.filter(w => w.projectId === project.id);
    if (projWritings.length > 0) {
      for (const writing of projWritings) {
        const wName = sanitize(writing.title);
        zip.file(`${projDir}/writings/${wName}__${writing.id}.json`, JSON.stringify(writing, null, 2));
      }
    }

    // ---- Timelines & Events ----
    const projTimelines = timelines.filter(t => t.projectId === project.id);
    if (projTimelines.length > 0) {
      for (const tl of projTimelines) {
        const tlName = sanitize(tl.title);
        const tlDir = `${projDir}/timelines/${tlName}__${tl.id}`;
        const tlEvents = timelineEvents.filter(e => e.timelineId === tl.id);
        zip.file(`${tlDir}/timeline.json`, JSON.stringify(tl, null, 2));
        if (tlEvents.length > 0) {
          zip.file(`${tlDir}/events.json`, JSON.stringify(tlEvents, null, 2));
        }
      }
    }

    // ---- Yarn Boards, Nodes & Edges ----
    const projBoards = yarnBoards.filter(b => b.projectId === project.id);
    if (projBoards.length > 0) {
      for (const board of projBoards) {
        const bName = sanitize(board.title);
        const bDir = `${projDir}/yarn-boards/${bName}__${board.id}`;
        const bNodes = yarnNodes.filter(n => n.boardId === board.id);
        const bEdges = yarnEdges.filter(e => e.boardId === board.id);

        // Extract node images
        const nodesMeta = bNodes.map(node => {
          if (node.image) {
            const { blob, ext } = dataUrlToBlob(node.image);
            zip.file(`${bDir}/node-images/${node.id}.${ext}`, blob);
            return { ...node, image: `node-images/${node.id}.${ext}` };
          }
          return node;
        });

        zip.file(`${bDir}/board.json`, JSON.stringify(board, null, 2));
        if (nodesMeta.length > 0) zip.file(`${bDir}/nodes.json`, JSON.stringify(nodesMeta, null, 2));
        if (bEdges.length > 0) zip.file(`${bDir}/edges.json`, JSON.stringify(bEdges, null, 2));
      }
    }

    // ---- Maps & Pins ----
    const projMaps = worldMaps.filter(m => m.projectId === project.id);
    if (projMaps.length > 0) {
      for (const map of projMaps) {
        const mName = sanitize(map.title);
        const mDir = `${projDir}/maps/${mName}__${map.id}`;
        const mapMeta = { ...map };

        if (mapMeta.backgroundImage) {
          const { blob, ext } = dataUrlToBlob(mapMeta.backgroundImage);
          zip.file(`${mDir}/background.${ext}`, blob);
          (mapMeta as Record<string, unknown>).backgroundImage = `background.${ext}`;
        }

        const mPins = mapPins.filter(p => p.mapId === map.id);
        zip.file(`${mDir}/map.json`, JSON.stringify(mapMeta, null, 2));
        if (mPins.length > 0) zip.file(`${mDir}/pins.json`, JSON.stringify(mPins, null, 2));
      }
    }

    // ---- Gallery (Collections + Images) ----
    const projCollections = imageCollections.filter(c => c.projectId === project.id);
    const projImages = inspirationImages.filter(i => i.projectId === project.id);

    if (projImages.length > 0) {
      // Export collections metadata
      if (projCollections.length > 0) {
        zip.file(`${projDir}/gallery/collections.json`, JSON.stringify(projCollections, null, 2));
      }

      // Group images by collection
      const uncategorized = projImages.filter(img => !img.collectionId);
      const byCollection = new Map<string, typeof projImages>();
      for (const col of projCollections) {
        byCollection.set(col.id, projImages.filter(img => img.collectionId === col.id));
      }

      // Helper: export image to folder
      const exportImage = (img: typeof projImages[0], folder: string, index: number) => {
        const imgMeta = { ...img };
        // Main image
        if (imgMeta.imageData) {
          const { blob, ext } = dataUrlToBlob(imgMeta.imageData);
          const filename = `${String(index + 1).padStart(3, '0')}.${ext}`;
          zip.file(`${folder}/${filename}`, blob);
          (imgMeta as Record<string, unknown>).imageData = filename;
        }
        // Thumbnail
        if (imgMeta.thumbnailData) {
          const { blob, ext } = dataUrlToBlob(imgMeta.thumbnailData);
          const filename = `${String(index + 1).padStart(3, '0')}_thumb.${ext}`;
          zip.file(`${folder}/${filename}`, blob);
          (imgMeta as Record<string, unknown>).thumbnailData = filename;
        }
        return imgMeta;
      };

      // Uncategorized images
      if (uncategorized.length > 0) {
        const metas = uncategorized.map((img, i) =>
          exportImage(img, `${projDir}/gallery/unsorted`, i)
        );
        zip.file(`${projDir}/gallery/unsorted/images.json`, JSON.stringify(metas, null, 2));
      }

      // Per-collection images
      for (const col of projCollections) {
        const colImages = byCollection.get(col.id) || [];
        if (colImages.length === 0) continue;
        const colName = sanitize(col.title);
        const colDir = `${projDir}/gallery/${colName}__${col.id}`;
        const metas = colImages.map((img, i) => exportImage(img, colDir, i));
        zip.file(`${colDir}/images.json`, JSON.stringify(metas, null, 2));
      }
    }

    // ---- External Links ----
    const projLinks = externalLinks.filter(l => l.projectId === project.id);
    if (projLinks.length > 0) {
      zip.file(`${projDir}/links/links.json`, JSON.stringify(projLinks, null, 2));
    }

    // ---- Engine-registered backup strategies ----
    // Each engine that has registered a BackupStrategy in its index.ts
    // gets a chance to write its own data here. This is how we cover
    // engines added after the original backup format was designed
    // (diary, biography, dialog-scene, brainstorm, outline, writing-stats,
    // storyboard, video-planner, scrapper, timelineConnections).
    for (const strategy of getAllBackupStrategies()) {
      try {
        await strategy.exportProject({ zip, projectId: project.id, projectDir: projDir });
      } catch (err) {
        console.error(`Backup export failed for engine "${strategy.engineId}":`, err);
      }
    }
  }

  // Generate and download
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const date = new Date().toISOString().slice(0, 10);
  saveAs(blob, `writers-hoard-backup-${date}.zip`);
}


// ============================================
// IMPORT
// ============================================

// Read a file from zip, return parsed JSON or null
async function readJson<T>(zip: JSZip, path: string): Promise<T | null> {
  const file = zip.file(path);
  if (!file) return null;
  const text = await file.async('text');
  return JSON.parse(text) as T;
}

// Read an image file from zip, return base64 data URL
async function readImageAsDataUrl(zip: JSZip, basePath: string, relativePath: string): Promise<string | undefined> {
  if (!relativePath || relativePath.startsWith('data:')) return relativePath || undefined;
  const fullPath = basePath ? `${basePath}/${relativePath}` : relativePath;
  const file = zip.file(fullPath);
  if (!file) return undefined;

  const ext = relativePath.split('.').pop()?.toLowerCase() || 'png';
  const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
  const mime = mimeMap[ext] || 'image/png';

  const base64 = await file.async('base64');
  return `data:${mime};base64,${base64}`;
}

export async function importFullZip(file: File): Promise<void> {
  const zip = await JSZip.loadAsync(file);

  // Check manifest
  const manifest = await readJson<{ app: string; version: number }>(zip, 'manifest.json');
  if (!manifest || manifest.app !== 'WritersHoard') {
    throw new Error('Invalid backup file: not a Writer\'s Hoard backup');
  }

  // Clear all tables. The legacy list covers engines hardcoded into this
  // file; engine-registered strategies contribute their own table names so
  // no data from previously-imported projects lingers in newer tables
  // (diary, biography, outline, etc.).
  const legacyTables: string[] = [
    'projects', 'codexEntries', 'writings', 'timelines', 'timelineEvents',
    'yarnBoards', 'yarnNodes', 'yarnEdges', 'worldMaps', 'mapPins',
    'imageCollections', 'inspirationImages', 'externalLinks', 'tags', 'settings',
  ];
  const strategyTables = getAllBackupStrategies().flatMap(s => s.tables);
  const knownTables = new Set(db.tables.map(t => t.name));
  const allTables = Array.from(new Set([...legacyTables, ...strategyTables]))
    .filter(t => knownTables.has(t));

  await db.transaction('rw', allTables.map(t => db.table(t)), async () => {
    await Promise.all(allTables.map(t => db.table(t).clear()));
  });

  // Import global data
  const settings = await readJson<unknown[]>(zip, 'settings.json');
  if (settings?.length) await db.settings.bulkAdd(settings as never[]);

  const tags = await readJson<unknown[]>(zip, 'tags.json');
  if (tags?.length) await db.tags.bulkAdd(tags as never[]);

  // Find all project directories
  const projectDirs = new Set<string>();
  zip.forEach((path) => {
    const match = path.match(/^projects\/([^/]+)\//);
    if (match) projectDirs.add(`projects/${match[1]}`);
  });

  for (const projDir of projectDirs) {
    // --- Project ---
    const projData = await readJson<Record<string, unknown>>(zip, `${projDir}/project.json`);
    if (!projData) continue;

    // Restore cover image
    if (projData.coverImage && typeof projData.coverImage === 'string' && !projData.coverImage.startsWith('data:')) {
      projData.coverImage = await readImageAsDataUrl(zip, projDir, projData.coverImage as string) || undefined;
    }
    await db.projects.add(projData as never);

    // --- Codex ---
    const codexFolder = `${projDir}/codex/`;
    const codexDirs = new Set<string>();
    zip.forEach((path) => {
      if (path.startsWith(codexFolder)) {
        const sub = path.slice(codexFolder.length);
        const dir = sub.split('/')[0];
        if (dir) codexDirs.add(`${codexFolder}${dir}`);
      }
    });

    for (const entryDir of codexDirs) {
      const entry = await readJson<Record<string, unknown>>(zip, `${entryDir}/entry.json`);
      if (!entry) continue;
      if (entry.avatar && typeof entry.avatar === 'string' && !entry.avatar.startsWith('data:')) {
        entry.avatar = await readImageAsDataUrl(zip, entryDir, entry.avatar as string) || undefined;
      }
      await db.codexEntries.add(entry as never);
    }

    // --- Writings ---
    const writingsFolder = `${projDir}/writings/`;
    const writingFiles: string[] = [];
    zip.forEach((path) => {
      if (path.startsWith(writingsFolder) && path.endsWith('.json')) writingFiles.push(path);
    });
    for (const wf of writingFiles) {
      const writing = await readJson<Record<string, unknown>>(zip, wf);
      if (writing) await db.writings.add(writing as never);
    }

    // --- Timelines ---
    const timelinesFolder = `${projDir}/timelines/`;
    const tlDirs = new Set<string>();
    zip.forEach((path) => {
      if (path.startsWith(timelinesFolder)) {
        const sub = path.slice(timelinesFolder.length);
        const dir = sub.split('/')[0];
        if (dir) tlDirs.add(`${timelinesFolder}${dir}`);
      }
    });
    for (const tlDir of tlDirs) {
      const tl = await readJson<Record<string, unknown>>(zip, `${tlDir}/timeline.json`);
      if (tl) await db.timelines.add(tl as never);
      const events = await readJson<Record<string, unknown>[]>(zip, `${tlDir}/events.json`);
      if (events?.length) await db.timelineEvents.bulkAdd(events as never[]);
    }

    // --- Yarn Boards ---
    const yarnFolder = `${projDir}/yarn-boards/`;
    const boardDirs = new Set<string>();
    zip.forEach((path) => {
      if (path.startsWith(yarnFolder)) {
        const sub = path.slice(yarnFolder.length);
        const dir = sub.split('/')[0];
        if (dir) boardDirs.add(`${yarnFolder}${dir}`);
      }
    });
    for (const bDir of boardDirs) {
      const board = await readJson<Record<string, unknown>>(zip, `${bDir}/board.json`);
      if (board) await db.yarnBoards.add(board as never);

      const nodes = await readJson<Record<string, unknown>[]>(zip, `${bDir}/nodes.json`);
      if (nodes?.length) {
        for (const node of nodes) {
          if (node.image && typeof node.image === 'string' && !node.image.startsWith('data:')) {
            node.image = await readImageAsDataUrl(zip, bDir, node.image as string) || undefined;
          }
          await db.yarnNodes.add(node as never);
        }
      }

      const edges = await readJson<Record<string, unknown>[]>(zip, `${bDir}/edges.json`);
      if (edges?.length) await db.yarnEdges.bulkAdd(edges as never[]);
    }

    // --- Maps ---
    const mapsFolder = `${projDir}/maps/`;
    const mapDirs = new Set<string>();
    zip.forEach((path) => {
      if (path.startsWith(mapsFolder)) {
        const sub = path.slice(mapsFolder.length);
        const dir = sub.split('/')[0];
        if (dir) mapDirs.add(`${mapsFolder}${dir}`);
      }
    });
    for (const mDir of mapDirs) {
      const mapData = await readJson<Record<string, unknown>>(zip, `${mDir}/map.json`);
      if (!mapData) continue;
      if (mapData.backgroundImage && typeof mapData.backgroundImage === 'string' && !mapData.backgroundImage.startsWith('data:')) {
        mapData.backgroundImage = await readImageAsDataUrl(zip, mDir, mapData.backgroundImage as string) || undefined;
      }
      await db.worldMaps.add(mapData as never);

      const pins = await readJson<Record<string, unknown>[]>(zip, `${mDir}/pins.json`);
      if (pins?.length) await db.mapPins.bulkAdd(pins as never[]);
    }

    // --- Gallery ---
    const galleryFolder = `${projDir}/gallery/`;
    const galleryExists = zip.file(new RegExp(`^${galleryFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

    if (galleryExists.length > 0) {
      // Collections
      const collections = await readJson<Record<string, unknown>[]>(zip, `${galleryFolder}collections.json`);
      if (collections?.length) await db.imageCollections.bulkAdd(collections as never[]);

      // Find all image folders (unsorted + collection folders)
      const imgFolders = new Set<string>();
      zip.forEach((path) => {
        if (path.startsWith(galleryFolder) && path.includes('images.json')) {
          imgFolders.add(path.replace('/images.json', ''));
        }
      });

      for (const imgFolder of imgFolders) {
        const imgMetas = await readJson<Record<string, unknown>[]>(zip, `${imgFolder}/images.json`);
        if (!imgMetas?.length) continue;

        for (const imgMeta of imgMetas) {
          // Restore imageData
          if (imgMeta.imageData && typeof imgMeta.imageData === 'string' && !imgMeta.imageData.startsWith('data:')) {
            imgMeta.imageData = await readImageAsDataUrl(zip, imgFolder, imgMeta.imageData as string) || '';
          }
          // Restore thumbnailData
          if (imgMeta.thumbnailData && typeof imgMeta.thumbnailData === 'string' && !imgMeta.thumbnailData.startsWith('data:')) {
            imgMeta.thumbnailData = await readImageAsDataUrl(zip, imgFolder, imgMeta.thumbnailData as string) || undefined;
          }
          await db.inspirationImages.add(imgMeta as never);
        }
      }
    }

    // --- External Links ---
    const links = await readJson<Record<string, unknown>[]>(zip, `${projDir}/links/links.json`);
    if (links?.length) await db.externalLinks.bulkAdd(links as never[]);

    // --- Engine-registered backup strategies ---
    // Invoke every strategy for this project. Strategies no-op silently if
    // their folder is missing (backward compatible with older backups).
    const projectIdForStrategies = (projData.id as string) || '';
    if (projectIdForStrategies) {
      for (const strategy of getAllBackupStrategies()) {
        try {
          await strategy.importProject({ zip, projectId: projectIdForStrategies, projectDir: projDir });
        } catch (err) {
          console.error(`Backup import failed for engine "${strategy.engineId}":`, err);
        }
      }
    }
  }
}
