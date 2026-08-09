export const REQUEST_TIMEOUT_MS = 8_000;

export {
  elapsed,
  log,
  logError,
  mapPool,
  settled,
  withTimeout,
} from "../async.js";

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isAuthFailure(error: unknown): boolean {
  const text = errorText(error).toLowerCase();
  return (
    /\b401\b/.test(text) ||
    /\b403\b/.test(text) ||
    text.includes("invalid_client") ||
    text.includes("unauthorized") ||
    text.includes("authorization_requestdenied") ||
    text.includes("insufficient privileges") ||
    text.includes("access denied") ||
    text.includes("authentication_failed") ||
    text.includes("aadsts")
  );
}

export function formatAuthFailure(namespace: string, error: unknown): string {
  const text = errorText(error);
  const lower = text.toLowerCase();

  if (lower.includes("invalid_client") || /\b401\b/.test(text)) {
    return `provider:${namespace}: Azure PAT / client credentials rejected — check PROVIDER_AZURE_${namespace}_CLIENT_ID and PROVIDER_AZURE_${namespace}_PAT.`;
  }
  if (
    lower.includes("authorization_requestdenied") ||
    lower.includes("insufficient privileges") ||
    /\b403\b/.test(text)
  ) {
    return `provider:${namespace}: Azure app is missing Microsoft Graph permission Application.Read.All (got 403).`;
  }
  if (lower.includes("aadsts700016") || lower.includes("application not found")) {
    return `provider:${namespace}: Azure application not found in tenant — check PROVIDER_AZURE_${namespace}_CLIENT_ID and TENANT_ID.`;
  }
  if (lower.includes("aadsts90002") || lower.includes("tenant")) {
    return `provider:${namespace}: Azure tenant rejected — check PROVIDER_AZURE_${namespace}_TENANT_ID.`;
  }
  return `provider:${namespace}: ${text}`;
}

export function formatPermissionHint(error: string): string {
  if (
    error.includes("403") ||
    error.toLowerCase().includes("authorization_requestdenied") ||
    error.toLowerCase().includes("insufficient privileges")
  ) {
    return `${error.split(":")[0]} — missing Application.Read.All (got 403)`;
  }
  return error;
}
