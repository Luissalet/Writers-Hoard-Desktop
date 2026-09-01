import { create } from 'zustand';
import {
  GoogleAuthError,
  getGoogleUserInfo,
  requestAccessToken,
  revokeToken,
} from '@/services/googleAuth';
import { t } from '@/i18n/useTranslation';

interface GoogleState {
  isAuthenticated: boolean;
  accessToken: string | null;
  /**
   * Epoch ms at which `accessToken` stops working. The GIS implicit flow issues
   * no refresh token, so this is a hard wall, not a hint: past it the token is
   * dead and the only recovery is connecting again.
   */
  expiresAt: number | null;
  userEmail: string | null;
  userName: string | null;
  userPicture: string | null;
  isLoading: boolean;
  error: string | null;

  login: () => Promise<void>;
  logout: () => Promise<void>;
  /** True only while there is a token that has not reached its expiry. */
  hasValidSession: () => boolean;
  /**
   * Drop the session and put the connect screen back. Called when the token's
   * expiry passes and when Drive/Docs answer 401 (an expired token, or access
   * revoked from the writer's Google account page).
   */
  expireSession: (message?: string) => void;
  clearError: () => void;
}

/** Everything a connected session holds, cleared in one place. */
const SIGNED_OUT = {
  isAuthenticated: false,
  accessToken: null,
  expiresAt: null,
  userEmail: null,
  userName: null,
  userPicture: null,
  isLoading: false,
} as const;

export const useGoogleStore = create<GoogleState>((set, get) => ({
  ...SIGNED_OUT,
  error: null,

  login: async () => {
    set({ isLoading: true, error: null });
    try {
      const session = await requestAccessToken();
      const userInfo = await getGoogleUserInfo(session.accessToken);
      set({
        isAuthenticated: true,
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
        userEmail: userInfo.email,
        userName: userInfo.name,
        userPicture: userInfo.picture,
        isLoading: false,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('gdocs.authError');
      set({ ...SIGNED_OUT, error: message });
    }
  },

  logout: async () => {
    const { accessToken } = get();
    // Reset first: the disconnect control has to answer immediately even if
    // Google's revoke endpoint is slow or unreachable.
    set({ ...SIGNED_OUT, error: null });
    if (accessToken) {
      await revokeToken(accessToken);
    }
  },

  hasValidSession: () => {
    const { isAuthenticated, accessToken, expiresAt } = get();
    return isAuthenticated && !!accessToken && !!expiresAt && Date.now() < expiresAt;
  },

  expireSession: (message?: string) => {
    // No revoke call: the token is already dead or already withdrawn, and
    // revoking a dead token just fails silently in the background.
    set({ ...SIGNED_OUT, error: message ?? t('gdocs.sessionExpired') });
  },

  clearError: () => set({ error: null }),
}));

/** Reset the session when the failure was Google refusing the token. */
export function handleGoogleAuthError(err: unknown): boolean {
  if (!(err instanceof GoogleAuthError)) return false;
  useGoogleStore.getState().expireSession(err.message || undefined);
  return true;
}
