/**
 * @deprecated 2026-05-28 — removed when the Media Downloader page switched
 * from the File System Access API to a browser-native `<a download>` flow.
 * Browser settings now own the save location (Downloads folder vs save-as
 * dialog), so we no longer need to pick or persist a directory handle.
 *
 * Safe to delete via a real `git rm` on a clean checkout.
 */
export {};
