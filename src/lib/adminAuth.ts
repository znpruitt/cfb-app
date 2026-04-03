const ADMIN_TOKEN_STORAGE_KEY = 'cfb_admin_token';

export function getStoredAdminToken(): string {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '';
}

export function hasStoredAdminToken(): boolean {
  return getStoredAdminToken().trim().length > 0;
}

export function setStoredAdminToken(token: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = token.trim();
  if (!trimmed) {
    window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, trimmed);
}

export function requireAdminAuthHeaders(): HeadersInit {
  const token = getStoredAdminToken().trim();
  // With Clerk auth, the session cookie is sent automatically by the browser.
  // Return empty headers when no token is set — Clerk handles auth via cookies.
  // TODO Phase 7: remove ADMIN_API_TOKEN path entirely once all clients use Clerk.
  return token ? { 'x-admin-token': token } : {};
}

export function getAdminAuthHeaders(): HeadersInit {
  const token = getStoredAdminToken().trim();
  return token ? { 'x-admin-token': token } : {};
}
