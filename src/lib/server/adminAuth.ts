function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getConfiguredAdminToken(): string {
  return process.env.ADMIN_API_TOKEN?.trim() ?? '';
}

export function isAdminTokenConfigured(): boolean {
  return getConfiguredAdminToken().length > 0;
}

export function readAdminTokenFromRequest(req: Request): string {
  const headerToken = req.headers.get('x-admin-token')?.trim();
  if (headerToken) return headerToken;

  const authHeader = req.headers.get('authorization')?.trim() ?? '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return '';
}

export function isAuthorizedAdminRequest(req: Request): boolean {
  const configured = getConfiguredAdminToken();
  if (!configured) {
    return !isProductionRuntime();
  }

  return readAdminTokenFromRequest(req) === configured;
}

function buildAdminAuthFailure(req: Request): { error: string; detail: string } {
  const configured = getConfiguredAdminToken();
  const provided = readAdminTokenFromRequest(req);

  if (!configured) {
    return {
      error: 'admin-token-server-misconfigured',
      detail:
        'ADMIN_API_TOKEN is not configured on the server. Commissioner actions are disabled until the server is configured.',
    };
  }

  if (!provided) {
    return {
      error: 'admin-token-required',
      detail:
        'This commissioner action requires an admin token. Save the token in the Admin / Debug panel and try again.',
    };
  }

  return {
    error: 'admin-token-invalid',
    detail: 'The provided admin token was rejected. Verify the token and try again.',
  };
}

export function requireAdminRequest(req: Request): Response | null {
  if (isAuthorizedAdminRequest(req)) return null;

  const failure = buildAdminAuthFailure(req);
  return Response.json(failure, { status: 401 });
}
