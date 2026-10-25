import { b, PROJECT_ID, s, type BridgeTool } from './schema';

export const WORLD_MARKDOWN_TOOLS: BridgeTool[] = [
  {
    name: 'wh_world_markdown_export',
    writes: false,
    timeoutMs: 180_000,
    description: 'Export one whole project as a readable Markdown vault (a ZIP, returned as base64): a .md file per Codex card (Codex/<type>/), chapter (Writings/), note (Notes/), timeline (Timelines/ as a dated list), map (Maps/), outline (Outlines/) and diary page (Diary/), each with YAML frontmatter (kind, type, title, aliases, tags, fields, updatedAt, id…) and the body as Markdown; links between cards as [[wikilinks]] (links the author made, and the first mention of each card in a document); tables as CSV (Tables/); an index.md; and a world.json with the project record minus embedded pictures. includeMedia: true adds pictures and sounds under media/ (default false). Read-only: nothing is stored. Refuses above 25 MB and says so; retry with includeMedia: false. Returns {fileName, files, bytes, includeMedia, summary (documents by kind), warnings?, base64}.',
    schema: { type: 'object', properties: { projectId: PROJECT_ID, entryId:s('Optional single saved author Codex card. Returns .md, or ZIP with includeMedia. No drafts/annotations; no player-safe claim. Legacy vault unchanged when omitted.',{minLength:1}),eraId:s('Effective era of the individual card; requires entryId.',{minLength:1}),includeMedia: b('Add pictures and sounds under media/. Default false.'), locale: s('Language of the headings inside the files.', { enum: ['es', 'en'] }) }, additionalProperties: false },
  },
];
