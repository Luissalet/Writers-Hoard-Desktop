// ============================================
// Google OAuth2 Authentication via Google Identity Services (GIS)
// ============================================

import { t } from '@/i18n/useTranslation';

// GIS types (loaded via script tag in index.html)
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: { type: string; message: string }) => void;
          }) => GoogleTokenClient;
          revoke: (token: string, callback?: () => void) => void;
        };
      };
    };
  }
}

interface GoogleTokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
}

const SCOPES = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

let tokenClient: GoogleTokenClient | null = null;

/**
 * An access token together with the instant it stops working.
 *
 * The GIS implicit flow hands back no refresh token, so there is nothing to
 * renew with: once `expiresAt` passes, the only way forward is to connect
 * again. Every caller reads this deadline instead of assuming that a token
 * still sitting in the store is still good — which is how a Drive listing
 * ended up 401ing behind a UI that claimed to be connected.
 */
export interface GoogleSession {
  accessToken: string;
  /** Epoch ms: `Date.now() + expires_in * 1000`, taken when GIS answered. */
  expiresAt: number;
}

/**
 * Google refused the token — it expired, or the writer revoked this app from
 * their Google account page. Callers drop the session and put the connect
 * screen back rather than showing Google's raw error body in a red chip.
 */
export class GoogleAuthError extends Error {}

/** GIS always sends `expires_in` (3600 s); an hour is the safe assumption. */
const FALLBACK_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

function tokenLifetimeMs(expiresIn: number | undefined): number {
  return typeof expiresIn === 'number' && expiresIn > 0
    ? expiresIn * 1000
    : FALLBACK_TOKEN_LIFETIME_MS;
}

/**
 * Turn a Drive/Docs 401 into a `GoogleAuthError` before any other error
 * handling sees it, so "the session is gone" never gets reported as "this
 * document failed".
 */
export function assertTokenAccepted(response: Response): void {
  if (response.status === 401) throw new GoogleAuthError(t('gdocs.sessionExpired'));
}

/**
 * Check if GIS library is loaded
 */
export function isGisLoaded(): boolean {
  return !!window.google?.accounts?.oauth2;
}

/**
 * Get the Client ID from environment variable
 */
function getClientId(): string {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      'VITE_GOOGLE_CLIENT_ID not set. Add it to your .env file.'
    );
  }
  return clientId;
}

/**
 * Initialize OAuth2 and request an access token.
 * Resolves with the token *and* its expiry — a token on its own is not enough
 * to know whether the integration still works.
 */
export function requestAccessToken(): Promise<GoogleSession> {
  return new Promise((resolve, reject) => {
    if (!isGisLoaded()) {
      reject(new Error(t('gdocs.gisNotLoaded')));
      return;
    }

    try {
      tokenClient = window.google!.accounts.oauth2.initTokenClient({
        client_id: getClientId(),
        scope: SCOPES,
        callback: (response: GoogleTokenResponse) => {
          if (response.error) {
            reject(new Error(`${t('gdocs.authError')}: ${response.error}`));
            return;
          }
          resolve({
            accessToken: response.access_token,
            expiresAt: Date.now() + tokenLifetimeMs(response.expires_in),
          });
        },
        error_callback: (error) => {
          reject(new Error(`${t('gdocs.authError')}: ${error.message}`));
        },
      });

      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (err: unknown) {
      reject(err);
    }
  });
}

/**
 * Revoke the current access token
 */
export function revokeToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    if (!isGisLoaded()) {
      resolve();
      return;
    }
    window.google!.accounts.oauth2.revoke(token, () => {
      resolve();
    });
  });
}

/**
 * Fetch Google user info to get email/name
 */
export async function getGoogleUserInfo(accessToken: string): Promise<{
  email: string;
  name: string;
  picture: string;
}> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  assertTokenAccepted(response);
  if (!response.ok) {
    throw new Error(t('gdocs.authError'));
  }
  return response.json();
}
