// ============================================
// Scrapper Engine — URL Detection Service
// ============================================

import type { SnapshotSource } from '../types';

/**
 * Hostname of a URL, tolerant of input the user just pasted (no scheme).
 * Returns '' when there is nothing parseable.
 */
export function hostnameOf(url: string): string {
  const raw = (url || '').trim();
  if (!raw) return '';
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** True when `host` is exactly `domain` or a subdomain of it. */
function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Which kind of thing a URL points at.
 *
 * Substring matching was actively harmful here: `url.includes('x.com')` is true
 * for netflix.com, linux.com and phoenix.com, so ordinary web pages were
 * classified as tweets, took the media-download path instead of the page
 * archiver, and ended up stuck in `downloadState: 'error'` with nothing
 * captured. Matching on the parsed hostname (exact or subdomain) fixes the
 * whole family at once.
 */
export function detectUrlSource(url: string): SnapshotSource {
  const host = hostnameOf(url);
  if (!host) return 'url';
  if (hostMatches(host, 'twitter.com') || hostMatches(host, 'x.com')) return 'tweet';
  if (hostMatches(host, 'instagram.com')) return 'instagram';
  if (hostMatches(host, 'youtube.com') || hostMatches(host, 'youtu.be')) return 'youtube';
  return 'url';
}

export function extractYouTubeId(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // Handle youtu.be short form
    if (urlObj.hostname === 'youtu.be') {
      const id = urlObj.pathname.slice(1).split('?')[0];
      return id || null;
    }

    // Handle youtube.com long form
    if (urlObj.hostname.includes('youtube.com')) {
      const id = urlObj.searchParams.get('v');
      if (id) return id;

      // Handle youtube.com/embed/ID
      const match = urlObj.pathname.match(/\/embed\/([^/?]+)/);
      if (match) return match[1];
    }

    return null;
  } catch {
    return null;
  }
}

export function extractTweetInfo(url: string): { username?: string; tweetId?: string } {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Match /username/status/tweetId
    const match = pathname.match(/\/([^/]+)\/status\/(\d+)/);
    if (match) {
      return {
        username: match[1],
        tweetId: match[2],
      };
    }

    return {};
  } catch {
    return {};
  }
}

export function extractDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return url;
  }
}
