// ============================================
// Scrapper Engine — Import Instagram Collection Modal
// ============================================
//
// Three steps in one modal:
//   1. 'url'      — paste the link to an Instagram saved collection.
//   2. 'listing'  — gallery-dl lists every post (metadata only, no media
//                   downloaded yet). Paced 6-12s/request by design, so a
//                   collection with dozens of posts is a multi-minute wait —
//                   shown honestly instead of a bare spinner.
//   3. 'review'   — one card per post. Qwen (or whatever AI provider is
//                   configured) suggests tags from the project's EXISTING
//                   vocabulary, one post at a time; the user reviews/edits
//                   before anything is saved, and can uncheck posts to skip.
//
// Confirming hands the reviewed list up via `onImport` — this component never
// touches the DB or triggers a media download itself. ScrapperEngine owns
// that (mirrors how it already owns handleCapture for a single pasted link).

import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, Link2 } from 'lucide-react';
import TagInput from '@/components/common/TagInput';
import { useTranslation } from '@/i18n/useTranslation';
import {
  listInstagramCollection,
  cancelListInstagramCollection,
  type CollectionPost,
} from '../services/collectionImport';
import { suggestSnapshotTags } from '@/services/aiFeatures';
import type { AiConfig } from '@/types';
import Modal from '@/components/common/Modal';

export interface ImportedCollectionItem {
  url: string;
  description?: string;
  author?: string;
  /** YYYYMMDD, same shape gallery-dl/yt-dlp already use elsewhere in Scrapper. */
  uploadDate?: string;
  tags: string[];
}

interface ImportCollectionModalProps {
  /** Every distinct tag already used in this project — AI suggestions are constrained to this list. */
  allTags: string[];
  aiConfig: AiConfig;
  onImport: (items: ImportedCollectionItem[]) => void;
  onCancel: () => void;
}

type Step = 'url' | 'listing' | 'review';

interface ReviewItem {
  post: CollectionPost;
  included: boolean;
  tags: string[];
  tagsLoading: boolean;
  tagsFailed: boolean;
}

export default function ImportCollectionModal({
  allTags,
  aiConfig,
  onImport,
  onCancel,
}: ImportCollectionModalProps) {
  const { t, locale } = useTranslation();
  const [step, setStep] = useState<Step>('url');
  const [url, setUrl] = useState('');
  const [listError, setListError] = useState<string | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const handleUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && url.trim()) {
      void handleList();
    }
  };

  const handleList = async () => {
    if (!url.trim()) return;
    setListError(null);
    setStep('listing');
    try {
      const posts = await listInstagramCollection(url.trim());
      if (cancelledRef.current) return;
      if (posts.length === 0) {
        setListError(t('scrapper.importCollection.empty'));
        setStep('url');
        return;
      }
      const aiOn = aiConfig.enabled;
      setItems(
        posts.map((post) => ({
          post,
          included: true,
          tags: [],
          tagsLoading: aiOn,
          tagsFailed: false,
        })),
      );
      setStep('review');
      if (aiOn) void suggestAllTags(posts);
    } catch (err) {
      if (cancelledRef.current) return;
      setListError(err instanceof Error ? err.message : String(err));
      setStep('url');
    }
  };

  // Sequential, on purpose: a local single-GPU Ollama model can't usefully
  // serve concurrent generations, and this keeps progress legible ("N/total").
  const suggestAllTags = async (posts: CollectionPost[]) => {
    for (let i = 0; i < posts.length; i++) {
      if (cancelledRef.current) return;
      const post = posts[i];
      try {
        const tags = await suggestSnapshotTags(post.description ?? '', allTags, aiConfig);
        if (cancelledRef.current) return;
        setItems((prev) =>
          prev.map((it) =>
            it.post.shortcode === post.shortcode ? { ...it, tags, tagsLoading: false } : it,
          ),
        );
      } catch {
        if (cancelledRef.current) return;
        setItems((prev) =>
          prev.map((it) =>
            it.post.shortcode === post.shortcode
              ? { ...it, tagsLoading: false, tagsFailed: true }
              : it,
          ),
        );
      }
    }
  };

  const handleCancelListing = () => {
    void cancelListInstagramCollection();
    setStep('url');
  };

  const handleClose = () => {
    if (step === 'listing') void cancelListInstagramCollection();
    onCancel();
  };

  const toggleIncluded = (shortcode: string) => {
    setItems((prev) =>
      prev.map((it) => (it.post.shortcode === shortcode ? { ...it, included: !it.included } : it)),
    );
  };

  const setItemTags = (shortcode: string, tags: string[]) => {
    setItems((prev) => (prev.map((it) => (it.post.shortcode === shortcode ? { ...it, tags } : it))));
  };

  const includedCount = items.filter((it) => it.included).length;
  const pendingTagCount = items.filter((it) => it.tagsLoading).length;

  const handleConfirm = () => {
    const confirmed: ImportedCollectionItem[] = items
      .filter((it) => it.included)
      .map((it) => ({
        url: it.post.url,
        description: it.post.description,
        author: it.post.uploader,
        uploadDate: it.post.uploadDate,
        tags: it.tags,
      }));
    onImport(confirmed);
  };

  return (
    <Modal open onClose={handleClose} title={t('scrapper.importCollection.title')} wide>
        {step === 'url' && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-muted">{t('scrapper.importCollection.urlHint')}</p>
            <div className="space-y-2">
              <label className="font-serif font-semibold text-foreground block">
                {t('scrapper.importCollection.urlLabel')}
              </label>
              <div className="relative">
                <Link2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={handleUrlKeyDown}
                  placeholder={t('scrapper.importCollection.urlPlaceholder')}
                  className="w-full pl-9 pr-4 py-2 bg-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-gold"
                  autoFocus
                />
              </div>
            </div>

            {listError && (
              <div role="alert" className="flex items-start gap-2 text-sm text-red-400 bg-red-600/10 border border-red-600/30 rounded-lg p-3">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                <span>{listError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-foreground hover:bg-surface rounded-lg transition-colors font-medium"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleList}
                disabled={!url.trim()}
                className="px-4 py-2 bg-accent-gold hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed text-black rounded-lg transition-colors font-medium"
              >
                {t('scrapper.importCollection.list')}
              </button>
            </div>
          </div>
        )}

        {step === 'listing' && (
          <div role="status" aria-live="polite" className="p-10 flex flex-col items-center justify-center gap-4 text-center">
            <Loader2 size={28} className="animate-spin text-accent-gold" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-foreground font-medium">{t('scrapper.importCollection.listing')}</p>
              <p className="text-xs text-muted max-w-sm">{t('scrapper.importCollection.listingHint')}</p>
            </div>
            <button
              type="button"
              onClick={handleCancelListing}
              className="mt-2 px-4 py-2 text-sm bg-elevated hover:bg-surface border border-border rounded-lg text-foreground transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        )}

        {step === 'review' && (
          <>
            <div className="px-6 pt-4 pb-2 flex-shrink-0">
              <p className="text-sm text-muted">
                {t('scrapper.importCollection.reviewHint')}
                {pendingTagCount > 0 && (
                  <span className="ml-1">
                    {t('scrapper.importCollection.suggesting')
                      .replace('{done}', String(items.length - pendingTagCount))
                      .replace('{total}', String(items.length))}
                  </span>
                )}
              </p>
              {!aiConfig.enabled && (
                <p className="text-xs text-muted mt-1">{t('scrapper.importCollection.aiDisabled')}</p>
              )}
            </div>

            <div className="px-6 pb-4 space-y-3 overflow-y-auto">
              {items.map((it) => (
                <div
                  key={it.post.shortcode}
                  className={`border border-border rounded-lg p-3 flex gap-3 transition-opacity ${
                    it.included ? '' : 'opacity-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={it.included}
                    onChange={() => toggleIncluded(it.post.shortcode)}
                    aria-label={t('scrapper.importCollection.includeItem').replace(
                      '{item}',
                      it.post.uploader ? `@${it.post.uploader}` : it.post.url,
                    )}
                    className="mt-1 flex-shrink-0 accent-accent-gold"
                  />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={it.post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-accent-gold hover:underline truncate"
                      >
                        {it.post.uploader ? `@${it.post.uploader}` : it.post.url}
                      </a>
                      {it.post.uploadDate && (
                        <span className="text-xs text-muted flex-shrink-0">
                          {(() => {
                            const match = /^(\d{4})(\d{2})(\d{2})$/.exec(it.post.uploadDate);
                            if (!match) return it.post.uploadDate;
                            return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
                              .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
                          })()}
                        </span>
                      )}
                    </div>
                    {it.post.description && (
                      <p className="text-sm text-foreground line-clamp-3">{it.post.description}</p>
                    )}
                    <div>
                      {it.tagsLoading ? (
                        <div className="flex items-center gap-1.5 text-xs text-muted">
                          <Loader2 size={12} className="animate-spin" />
                          {t('scrapper.importCollection.suggestingOne')}
                        </div>
                      ) : (
                        <>
                          {it.tagsFailed && (
                            <p className="text-xs text-muted mb-1">
                              {t('scrapper.importCollection.suggestFailed')}
                            </p>
                          )}
                          <TagInput
                            tags={it.tags}
                            onChange={(tags) => setItemTags(it.post.shortcode, tags)}
                            suggestions={allTags}
                          />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {step === 'review' && (
          <div className="sticky bottom-0 bg-surface border-t border-border px-6 py-4 flex items-center justify-between flex-shrink-0">
            <span className="text-sm text-muted">
              {t('scrapper.importCollection.selectedCount').replace('{count}', String(includedCount))}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-foreground hover:bg-elevated rounded-lg transition-colors font-medium"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={includedCount === 0}
                className="px-4 py-2 bg-accent-gold hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed text-black rounded-lg transition-colors font-medium"
              >
                {t('scrapper.importCollection.confirm').replace('{count}', String(includedCount))}
              </button>
            </div>
          </div>
        )}
    </Modal>
  );
}
