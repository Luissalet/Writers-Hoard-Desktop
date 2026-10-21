// Isolated Electron profiles make these persistence, rollback and failure tests
// repeatable without touching the installed Writer's database or microphone.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const root = path.resolve(__dirname, '..');
const suites = [
  ['vvd-codex-aliases.browser.tsx', 'testVvdCodexAliases'],
  ['vvd-reference-edit.browser.tsx', 'testVvdReferenceEdit'],
  ['codex-templates.browser.tsx', 'testCodexTemplates'],
  ['codex-template-hierarchy.browser.tsx', 'testCodexTemplateHierarchy'],
  ['codex-template-presentation.browser.tsx', 'testCodexTemplatePresentation'],
  ['inline-mentions.browser.ts', 'testInlineMentions'],
  ['indexed-mentions.browser.ts', 'testIndexedMentions'],
  ['codex-live-blocks.browser.tsx', 'testCodexLiveBlocks'],
  ['codex-text-links.browser.tsx', 'testCodexTextLinks'],
  ['world-graph.browser.ts', 'testWorldGraph'],
  ['world-graph-ui.browser.tsx', 'testWorldGraphUi'],
  ['vvd-maps.browser.tsx', 'testVvdMaps'],
  ['vvd-map-versions.browser.tsx', 'testVvdMapVersions'],
  ['vvd-map-import.browser.ts', 'testVvdMapImport'],
  ['worldgen-fixed-sheets.browser.tsx', 'testWorldgenFixedSheets'],
  ['board-freehand.browser.tsx', 'testBoardFreehand'],
  ['relation-trees.browser.tsx', 'testRelationTrees'],
  ['timeline-rich.browser.tsx', 'testTimelineRich'],
  ['timeline-scopes.browser.tsx', 'testTimelineScopes'],
  ['vvd-dictionary.browser.tsx', 'testVvdDictionary'],
  ['dictionary-scripts.browser.tsx', 'testDictionaryScripts'],
  ['vvd-tables.browser.tsx', 'testVvdTables'],
  ['rpg-sheets.browser.tsx', 'testRpgSheets'],
  ['radar.browser.tsx', 'testRadarCharts'],
  ['model-viewer.browser.tsx', 'testModelViewer'],
  ['vvd-media.browser.tsx', 'testVvdMedia'],
  ['media-blocks.browser.tsx', 'testMediaBlocks'],
  ['tool-document-blocks.browser.tsx', 'testToolDocumentBlocks'],
  ['wiki-export.browser.tsx', 'testWikiExport'],
  ['wiki-presentation.browser.tsx', 'testWikiPresentation'],
  ['reader-presentation.browser.tsx', 'testReaderPresentation'],
  ['reader-soundtrack.browser.tsx', 'testReaderSoundtrack'],
  ['project-soundtrack.browser.tsx', 'testProjectSoundtrack'],
  ['parallel-drafts.browser.tsx', 'testParallelDrafts'],
  ['project-workspace.browser.tsx', 'testProjectWorkspace'],
  ['project-workspace-engines.browser.tsx', 'testProjectWorkspaceEngines'],
  ['workspace-adapters.browser.ts', 'testWorkspaceAdapters'],
  ['workspace-recovery.browser.ts', 'testWorkspaceRecovery'],
  ['workspace-library.browser.tsx', 'testWorkspaceLibrary'],
  ['conversation-preview.browser.tsx', 'testConversationPreview'],
  ['document-archive.browser.tsx', 'testDocumentArchive'],
  ['vvd-world-portability.browser.ts', 'testVvdWorldPortability'],
  ['world-documents-search.browser.tsx', 'testWorldDocumentsSearch'],
  ['local-tool-sdk.browser.tsx', 'testLocalToolSdk'],
  // Map wave (Ágora 1095).
  ['world-presentation.browser.tsx', 'testWorldPresentationCore'],
  ['world-blank-starters.browser.ts', 'testWorldBlankStarters'],
  ['world-measure-area.browser.ts', 'testWorldMeasureArea'],
  ['world-travel-profile.browser.ts', 'testWorldTravelProfile'],
  ['world-map-eras.browser.ts', 'testWorldMapEras'],
  ['world-labels.browser.ts', 'testWorldLabels'],
  ['world-stamps.browser.ts', 'testWorldStamps'],
  ['world-journey-playback.browser.ts', 'testWorldJourneyPlayback'],
  ['world-grid.browser.ts', 'testWorldGrid'],
  ['world-reader-fog.browser.ts', 'testReaderFog'],
  ['world-story-events.browser.ts', 'testStoryEvents'],
];
const output = path.join(root, 'work', 'vvd-suite'); fs.mkdirSync(output, { recursive: true });
let checks = 0; const failed = [];
for (const [file, exported] of suites) {
  const result = spawnSync(electron, ['scripts/run-focused-browser-tests.cjs', `tests/${file}`, exported, '300000'], { cwd: root, encoding: 'utf8', timeout: 330000, maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  const log = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? '\n' + result.error.stack : ''}`;
  fs.writeFileSync(path.join(output, file + '.log'), log);
  const count = (log.match(/^PASS /gm) ?? []).length; checks += count;
  if (result.status !== 0 || result.error) { failed.push(file); console.error(`FAIL ${file} — ${path.join(output, file + '.log')}`); }
  else console.log(`PASS ${file}: ${count} groups`);
}
console.log(`VVD offline workflows: ${checks} groups, ${suites.length} suites, ${failed.length} failed. Logs: ${output}`);
if (failed.length) process.exitCode = 1;
