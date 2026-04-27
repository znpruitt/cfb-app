import { isPlatformAdminSession } from './adminAuth';

/**
 * Returns true if the current Clerk session is authorized to access the
 * commissioner draft board for the given slug.
 *
 * Today: platform_admin only.
 * Phase 7 (commissioner-per-league enforcement): will also return true for users
 * with commissioner role and slug in their publicMetadata.leagues array.
 */
export async function canAccessDraftBoard(slug: string): Promise<boolean> {
  // Phase 7 will OR in commissioner-scope check here.
  void slug;
  return isPlatformAdminSession();
}
