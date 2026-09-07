import imageCompression from 'browser-image-compression';

export const GALLERY_IMPORT_MAX_FILE_MB = 4;
export const GALLERY_IMPORT_MAX_EDGE = 4096;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Import cancelled', 'AbortError');
}

export function readFileAsDataUrl(file: File, signal: AbortSignal): Promise<string> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;

    const cleanup = () => {
      signal.removeEventListener('abort', handleAbort);
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const handleAbort = () => {
      if (reader.readyState === FileReader.LOADING) reader.abort();
      settle(() => reject(abortReason(signal)));
    };

    reader.onload = () => settle(() => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The selected file could not be converted to an image.'));
    });
    reader.onerror = () => settle(() => reject(reader.error ?? new Error('The selected file could not be read.')));
    reader.onabort = () => settle(() => reject(abortReason(signal)));
    signal.addEventListener('abort', handleAbort, { once: true });
    reader.readAsDataURL(file);
  });
}

/**
 * Bounds the persisted original before it becomes a Data URL. Animated GIFs
 * stay byte-for-byte intact because canvas compression would discard frames;
 * they are still protected by the queue's concurrency/backpressure.
 */
export async function prepareGalleryImportFile(file: File, signal: AbortSignal): Promise<string> {
  const prepared = file.type === 'image/gif'
    ? file
    : await imageCompression(file, {
        maxSizeMB: GALLERY_IMPORT_MAX_FILE_MB,
        maxWidthOrHeight: GALLERY_IMPORT_MAX_EDGE,
        initialQuality: 0.9,
        preserveExif: false,
        // The package's default worker bootstraps itself from a CDN. Writers
        // Hoard is local-first, so keep processing self-contained and let the
        // bounded queue protect the renderer instead of introducing a network
        // dependency here.
        useWebWorker: false,
        signal,
      });

  if (signal.aborted) throw abortReason(signal);
  return readFileAsDataUrl(prepared, signal);
}
