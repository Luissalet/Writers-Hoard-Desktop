import { useState } from 'react';
import { Sparkles, Users, Loader2, X, Check, CloudDownload, Merge, ArrowRight } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { useAiStore } from '@/stores/aiStore';
import { generateSummary, extractCharacters } from '@/services/aiFeatures';
import { safeAiCall } from '@/services/aiService';
import { generateId } from '@/utils/idGenerator';
import { useCodexEntries } from '@/hooks/useCodexEntries';
import type { Writing, ExtractedCharacter, CodexEntry } from '@/types';
import { CHARACTER_FIELDS } from '@/types';

interface AiToolbarProps {
  writing: Writing;
  projectId: string;
  onSynopsisUpdate: (synopsis: string) => void;
  /** Optional async function that fetches content (e.g. from Google Docs) when writing.content is empty */
  contentFetcher?: () => Promise<string>;
}

export default function AiToolbar({ writing, projectId, onSynopsisUpdate, contentFetcher }: AiToolbarProps) {
  const { config } = useAiStore();
  const { entries: codexEntries, addEntry, editEntry } = useCodexEntries(projectId);

  // Transiently fetched content (Google Docs, not persisted locally)
  const [fetchedContent, setFetchedContent] = useState<string | null>(null);
  const [fetchingContent, setFetchingContent] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Summary state
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryPreview, setSummaryPreview] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Characters state
  const [charsLoading, setCharsLoading] = useState(false);
  const [extractedChars, setExtractedChars] = useState<ExtractedCharacter[] | null>(null);
  const [selectedChars, setSelectedChars] = useState<Set<number>>(new Set());
  const [charsError, setCharsError] = useState<string | null>(null);
  const [charsImporting, setCharsImporting] = useState(false);

  if (!config.enabled) return null;

  /** Returns the best available content, fetching from Google Docs if needed */
  const ensureContent = async (): Promise<string | null> => {
    const local = fetchedContent || writing.content;
    if (local && local.length >= 50) return local;

    if (!contentFetcher) return null;

    setFetchingContent(true);
    setFetchError(null);
    try {
      const remote = await contentFetcher();
      setFetchedContent(remote);
      return remote;
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Error al cargar el documento');
      return null;
    } finally {
      setFetchingContent(false);
    }
  };

  const hasContentOrFetcher = !!(
    (fetchedContent && fetchedContent.length >= 50) ||
    (writing.content && writing.content.length >= 50) ||
    contentFetcher
  );

  // --- Summary ---
  const handleGenerateSummary = async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    const content = await ensureContent();
    if (!content) { setSummaryLoading(false); return; }

    const result = await safeAiCall(
      () => generateSummary(content, config),
      'Error al generar resumen. Inténtalo de nuevo.'
    );

    if (result.success) {
      setSummaryPreview(result.data);
    } else {
      setSummaryError(result.error);
    }
    setSummaryLoading(false);
  };

  const handleAcceptSummary = () => {
    if (summaryPreview) {
      onSynopsisUpdate(summaryPreview);
      setSummaryPreview(null);
    }
  };

  // --- Characters ---
  const handleExtractCharacters = async () => {
    setCharsLoading(true);
    setCharsError(null);
    const content = await ensureContent();
    if (!content) { setCharsLoading(false); return; }

    const result = await safeAiCall(
      () => extractCharacters(content, config),
      'Error al extraer personajes. Inténtalo de nuevo.'
    );

    if (result.success) {
      setExtractedChars(result.data);
      setSelectedChars(new Set(result.data.map((_, i) => i)));
    } else {
      setCharsError(result.error);
    }
    setCharsLoading(false);
  };

  const toggleCharSelect = (index: number) => {
    const next = new Set(selectedChars);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelectedChars(next);
  };

  // Merge state
  const [mergeConflicts, setMergeConflicts] = useState<{
    existing: CodexEntry;
    extracted: ExtractedCharacter;
    mergedFields: Record<string, string>;
    mergeContent: string;
  }[] | null>(null);

  const handleImportCharacters = async () => {
    if (!extractedChars) return;
    setCharsImporting(true);

    try {
      const selected = extractedChars.filter((_, i) => selectedChars.has(i));
      const existingEntries = codexEntries;
      const existingChars = existingEntries.filter(e => e.type === 'character');

      const toCreate: ExtractedCharacter[] = [];
      const toMerge: { existing: CodexEntry; extracted: ExtractedCharacter }[] = [];

      for (const char of selected) {
        const normalizedName = char.nombre.toLowerCase().trim();
        const match = existingChars.find(e =>
          e.title.toLowerCase().trim() === normalizedName ||
          (e.fields.name && e.fields.name.toLowerCase().trim() === normalizedName)
        );

        if (match) {
          toMerge.push({ existing: match, extracted: char });
        } else {
          toCreate.push(char);
        }
      }

      // Create new characters
      for (const char of toCreate) {
        const entry: CodexEntry = {
          id: generateId('cdx'),
          projectId,
          type: 'character',
          title: char.nombre,
          fields: {
            ...CHARACTER_FIELDS,
            name: char.nombre,
            physicalDescription: char.descripcionFisica,
            personality: char.personalidad,
            role: char.rol,
          },
          content: `<p><strong>Relaciones:</strong> ${char.relaciones}</p>
${char.citasRelevantes.length > 0
  ? `<p><strong>Citas relevantes:</strong></p><ul>${char.citasRelevantes.map((c) => `<li>"${c}"</li>`).join('')}</ul>`
  : ''}`,
          tags: ['ai-extracted'],
          relations: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await addEntry(entry);
      }

      // If there are merge conflicts, show merge UI
      if (toMerge.length > 0) {
        setMergeConflicts(toMerge.map(({ existing, extracted }) => {
          // Auto-merge: fill empty fields with AI data, keep existing data when present
          const mergedFields = { ...existing.fields };
          const aiFields: Record<string, string> = {
            name: extracted.nombre,
            physicalDescription: extracted.descripcionFisica,
            personality: extracted.personalidad,
            role: extracted.rol,
          };
          for (const [key, val] of Object.entries(aiFields)) {
            if (val && val !== 'No descrito' && (!mergedFields[key] || !mergedFields[key].trim())) {
              mergedFields[key] = val;
            }
          }

          // Append new content
          const newContent = `<p><strong>Relaciones:</strong> ${extracted.relaciones}</p>
${extracted.citasRelevantes.length > 0
  ? `<p><strong>Citas relevantes:</strong></p><ul>${extracted.citasRelevantes.map((c) => `<li>"${c}"</li>`).join('')}</ul>`
  : ''}`;
          const mergeContent = existing.content
            ? `${existing.content}\n<hr/>\n<p><em>--- AI Update ---</em></p>\n${newContent}`
            : newContent;

          return { existing, extracted, mergedFields, mergeContent };
        }));
      }

      if (toMerge.length === 0) {
        setExtractedChars(null);
        setSelectedChars(new Set());
      }
    } catch {
      setCharsError('Error al importar personajes al Codex');
    } finally {
      setCharsImporting(false);
    }
  };

  const handleConfirmMerge = async () => {
    if (!mergeConflicts) return;
    setCharsImporting(true);
    try {
      for (const conflict of mergeConflicts) {
        await editEntry(conflict.existing.id, {
          fields: conflict.mergedFields,
          content: conflict.mergeContent,
          tags: [...new Set([...conflict.existing.tags, 'ai-merged'])],
        });
      }
      setMergeConflicts(null);
      setExtractedChars(null);
      setSelectedChars(new Set());
    } catch {
      setCharsError('Error al fusionar personajes');
    } finally {
      setCharsImporting(false);
    }
  };

  const rolColor: Record<string, string> = {
    protagonista: 'text-accent-gold',
    secundario: 'text-blue-400',
    mencionado: 'text-text-dim',
  };

  const isBusy = summaryLoading || charsLoading || fetchingContent;

  return (
    <>
      {/* Toolbar buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleGenerateSummary}
          disabled={isBusy || !hasContentOrFetcher}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {summaryLoading || (fetchingContent && !charsLoading)
            ? <Loader2 size={13} className="animate-spin" />
            : <Sparkles size={13} />}
          {fetchingContent && !charsLoading ? 'Cargando doc...' : 'Generar Resumen'}
        </button>

        <button
          onClick={handleExtractCharacters}
          disabled={isBusy || !hasContentOrFetcher}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {charsLoading || (fetchingContent && !summaryLoading)
            ? <Loader2 size={13} className="animate-spin" />
            : <Users size={13} />}
          {fetchingContent && !summaryLoading ? 'Cargando doc...' : 'Extraer Personajes'}
        </button>

        {/* Fetched content indicator */}
        {fetchedContent && (
          <span className="text-[10px] text-blue-400 flex items-center gap-1">
            <CloudDownload size={10} />
            Contenido cargado desde Google Docs
          </span>
        )}

        {/* Inline errors */}
        {fetchError && (
          <span className="text-[10px] text-red-400 flex items-center gap-1">
            {fetchError}
            <button onClick={() => setFetchError(null)}><X size={10} /></button>
          </span>
        )}
        {summaryError && (
          <span className="text-[10px] text-red-400 flex items-center gap-1">
            {summaryError}
            <button onClick={() => setSummaryError(null)}><X size={10} /></button>
          </span>
        )}
        {charsError && (
          <span className="text-[10px] text-red-400 flex items-center gap-1">
            {charsError}
            <button onClick={() => setCharsError(null)}><X size={10} /></button>
          </span>
        )}
      </div>

      {/* Summary preview modal */}
      <Modal open={!!summaryPreview} onClose={() => setSummaryPreview(null)} title="Resumen Generado">
        <div className="space-y-4">
          <div className="p-4 bg-elevated rounded-lg text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
            {summaryPreview}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleAcceptSummary}
              className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition inline-flex items-center justify-center gap-2"
            >
              <Check size={16} />
              Guardar como Sinopsis
            </button>
            <button
              onClick={() => setSummaryPreview(null)}
              className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition"
            >
              Descartar
            </button>
          </div>
        </div>
      </Modal>

      {/* Merge conflicts modal */}
      <Modal
        open={!!mergeConflicts}
        onClose={() => setMergeConflicts(null)}
        title="Fusionar Personajes Existentes"
        wide
      >
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            Los siguientes personajes ya existen en el Codex. Los datos de la IA se fusionarán con los existentes (los campos vacíos se rellenarán automáticamente).
          </p>

          <div className="max-h-80 overflow-y-auto space-y-3">
            {mergeConflicts?.map((conflict, i) => (
              <div key={i} className="p-3 bg-elevated rounded-lg border border-border">
                <div className="flex items-center gap-2 mb-2">
                  <Merge size={14} className="text-accent-gold" />
                  <span className="font-semibold text-sm text-text-primary">{conflict.existing.title}</span>
                  <ArrowRight size={12} className="text-text-dim" />
                  <span className="text-xs text-emerald-400">{conflict.extracted.nombre}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(conflict.mergedFields)
                    .filter(([, v]) => v && v.trim())
                    .slice(0, 4)
                    .map(([key, val]) => {
                      const isNew = !conflict.existing.fields[key]?.trim() && val.trim();
                      return (
                        <div key={key} className={`p-1.5 rounded ${isNew ? 'bg-emerald-500/10 border border-emerald-400/20' : 'bg-surface'}`}>
                          <span className="text-text-dim capitalize">{key.replace(/([A-Z])/g, ' $1')}: </span>
                          <span className="text-text-primary">{val.slice(0, 60)}{val.length > 60 ? '...' : ''}</span>
                          {isNew && <span className="text-emerald-400 ml-1">(new)</span>}
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 pt-2 border-t border-border">
            <button
              onClick={handleConfirmMerge}
              disabled={charsImporting}
              className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {charsImporting ? <Loader2 size={14} className="animate-spin" /> : <Merge size={14} />}
              Fusionar {mergeConflicts?.length} Personaje{mergeConflicts && mergeConflicts.length > 1 ? 's' : ''}
            </button>
            <button
              onClick={() => { setMergeConflicts(null); setExtractedChars(null); setSelectedChars(new Set()); }}
              className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      </Modal>

      {/* Characters preview modal */}
      <Modal
        open={!!extractedChars && !mergeConflicts}
        onClose={() => { setExtractedChars(null); setSelectedChars(new Set()); }}
        title="Personajes Extraídos"
        wide
      >
        <div className="space-y-4">
          {extractedChars && extractedChars.length === 0 && (
            <p className="text-sm text-text-muted text-center py-4">
              No se encontraron personajes en el texto.
            </p>
          )}

          <div className="max-h-80 overflow-y-auto space-y-2">
            {extractedChars?.map((char, i) => (
              <button
                key={i}
                onClick={() => toggleCharSelect(i)}
                className={`w-full text-left p-3 rounded-lg border transition ${
                  selectedChars.has(i)
                    ? 'bg-emerald-500/10 border-emerald-400/30'
                    : 'bg-elevated border-border hover:border-emerald-400/20'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 border ${
                      selectedChars.has(i)
                        ? 'bg-emerald-500 border-emerald-500'
                        : 'border-border'
                    }`}
                  >
                    {selectedChars.has(i) && <Check size={12} className="text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-text-primary">{char.nombre}</span>
                      <span className={`text-[10px] ${rolColor[char.rol] || 'text-text-dim'}`}>
                        {char.rol}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted mt-1">{char.personalidad}</p>
                    {char.descripcionFisica !== 'No descrito' && (
                      <p className="text-[10px] text-text-dim mt-0.5">{char.descripcionFisica}</p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {extractedChars && extractedChars.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-sm text-text-muted">
                {selectedChars.size} personaje{selectedChars.size !== 1 ? 's' : ''} seleccionado{selectedChars.size !== 1 ? 's' : ''}
              </span>
              <button
                onClick={handleImportCharacters}
                disabled={selectedChars.size === 0 || charsImporting}
                className="px-5 py-2 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition disabled:opacity-50 inline-flex items-center gap-2"
              >
                {charsImporting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Importando...
                  </>
                ) : (
                  'Importar al Codex'
                )}
              </button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
