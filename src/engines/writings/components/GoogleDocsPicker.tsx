import { useState, useEffect } from 'react';
import { Search, Cloud, Check, Loader2, FileText, AlertCircle } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { useGoogleStore } from '@/stores/googleStore';
import { listGoogleDocs, importGoogleDoc, type GoogleDocFile } from '@/services/googleDocs';
import { isGisLoaded } from '@/services/googleAuth';
import { t } from '@/i18n/useTranslation';
import type { Writing } from '@/types';

interface GoogleDocsPickerProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  existingWritings: Writing[];
  onImported: () => void;
}

export default function GoogleDocsPicker({
  open,
  onClose,
  projectId,
  existingWritings,
  onImported,
}: GoogleDocsPickerProps) {
  const { isAuthenticated, accessToken, userEmail, login, isLoading: authLoading, error: authError } = useGoogleStore();

  const [docs, setDocs] = useState<GoogleDocFile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

  // Already imported doc IDs
  const importedDocIds = new Set(
    existingWritings
      .filter((w) => w.googleDocId)
      .map((w) => w.googleDocId!)
  );

  // Load docs when authenticated
  useEffect(() => {
    if (open && isAuthenticated && accessToken) {
      loadDocs();
    }
  }, [open, isAuthenticated, accessToken]);

  const loadDocs = async (query?: string) => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const files = await listGoogleDocs(accessToken, query);
      setDocs(files);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('docs.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    loadDocs(searchQuery || undefined);
  };

  const toggleSelect = (docId: string) => {
    const next = new Set(selectedIds);
    if (next.has(docId)) {
      next.delete(docId);
    } else {
      next.add(docId);
    }
    setSelectedIds(next);
  };

  const handleImport = async () => {
    if (!accessToken || selectedIds.size === 0) return;

    setImporting(true);
    setImportProgress(0);

    const selectedDocs = docs.filter((d) => selectedIds.has(d.id));
    let completed = 0;

    try {
      for (const doc of selectedDocs) {
        await importGoogleDoc(accessToken, doc, projectId);
        completed++;
        setImportProgress(Math.round((completed / selectedDocs.length) * 100));
      }
      setSelectedIds(new Set());
      onImported();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('docs.importError'));
    } finally {
      setImporting(false);
    }
  };

  // Not authenticated — show connect screen
  if (!isAuthenticated) {
    return (
      <Modal open={open} onClose={onClose} title={t('gdocs.linkTitle')}>
        <div className="text-center py-6 space-y-4">
          <Cloud size={48} className="mx-auto text-blue-400 opacity-60" />
          <div>
            <h3 className="text-text-primary font-semibold mb-1">{t('gdocs.connectHeading')}</h3>
            <p className="text-sm text-text-muted">
              {t('gdocs.connectHint')}
            </p>
          </div>

          {!isGisLoaded() && (
            <div className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 text-yellow-400 text-xs rounded-lg">
              <AlertCircle size={14} />
              <span>{t('gdocs.gisNotLoaded')}</span>
            </div>
          )}

          {authError && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 text-xs rounded-lg">
              <AlertCircle size={14} />
              <span>{authError}</span>
            </div>
          )}

          <button
            onClick={login}
            disabled={authLoading || !isGisLoaded()}
            className="px-6 py-2.5 bg-blue-500 text-white font-semibold rounded-lg hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {authLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {t('gdocs.connecting')}
              </>
            ) : (
              <>
                <Cloud size={16} />
                {t('gdocs.connectDrive')}
              </>
            )}
          </button>
        </div>
      </Modal>
    );
  }

  // Authenticated — show file browser
  return (
    <Modal open={open} onClose={onClose} title={t('gdocs.linkTitle')} wide>
      <div className="space-y-4">
        {/* User info */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">
            {t('gdocs.connectedAs')} <span className="text-blue-400">{userEmail}</span>
          </span>
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
              placeholder={t('gdocs.searchDocs')}
              className="w-full pl-9 pr-4 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-blue-400/50 transition"
            />
          </div>
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-elevated border border-border rounded-lg text-sm text-text-muted hover:text-text-primary transition"
          >
            {t('gdocs.searchButton')}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 text-xs rounded-lg">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* Doc list */}
        <div className="max-h-80 overflow-y-auto space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-text-muted" />
            </div>
          ) : docs.length === 0 ? (
            <div className="text-center py-12 text-text-muted text-sm">
              {t('gdocs.noDocsFound')}
            </div>
          ) : (
            docs.map((doc) => {
              const isImported = importedDocIds.has(doc.id);
              const isSelected = selectedIds.has(doc.id);

              return (
                <button
                  key={doc.id}
                  onClick={() => !isImported && toggleSelect(doc.id)}
                  disabled={isImported}
                  className={`w-full text-left flex items-center gap-3 p-3 rounded-lg transition ${
                    isImported
                      ? 'opacity-50 cursor-not-allowed bg-elevated/50'
                      : isSelected
                      ? 'bg-blue-500/10 border border-blue-400/30'
                      : 'hover:bg-elevated border border-transparent'
                  }`}
                >
                  {/* Checkbox */}
                  <div
                    className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border ${
                      isImported
                        ? 'bg-green-500/20 border-green-500/40'
                        : isSelected
                        ? 'bg-blue-500 border-blue-500'
                        : 'border-border'
                    }`}
                  >
                    {(isImported || isSelected) && <Check size={12} className="text-white" />}
                  </div>

                  {/* Doc info */}
                  <FileText size={16} className="text-blue-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary truncate">{doc.name}</p>
                    <p className="text-[10px] text-text-dim">
                      {isImported ? t('gdocs.alreadyLinked') : `${t('gdocs.modified')} ${new Date(doc.modifiedTime).toLocaleDateString()}`}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Import button */}
        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-sm text-text-muted">
              {t('gdocs.selectedCount').replace('{count}', String(selectedIds.size))}
            </span>
            <button
              onClick={handleImport}
              disabled={importing}
              className="px-5 py-2 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition disabled:opacity-50 inline-flex items-center gap-2"
            >
              {importing ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {t('gdocs.linking')} {importProgress}%
                </>
              ) : (
                t('gdocs.link')
              )}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
