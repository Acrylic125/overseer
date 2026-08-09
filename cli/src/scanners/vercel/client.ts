export const REQUEST_TIMEOUT_MS = 8_000;
export const PROJECT_CONCURRENCY = 3;

export { elapsed, log, logError, mapPool, settled, withTimeout } from "../async.js";

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isAuthFailure(error: unknown): boolean {
  const text = errorText(error);
  return (
    /\b401\b/.test(text) ||
    /\b403\b/.test(text) ||
    text.toLowerCase().includes("not authorized") ||
    text.toLowerCase().includes("unauthorized") ||
    text.toLowerCase().includes("invalid token") ||
    text.toLowerCase().includes("authentication")
  );
}

export function formatAuthFailure(namespace: string, error: unknown): string {
  const text = errorText(error);
  if (/\b403\b/.test(text)) {
    return `provider:${namespace}: Vercel API token is missing permission (got 403). Check PROVIDER_VERCEL_${namespace}_API_KEY scopes.`;
  }
  if (
    /\b401\b/.test(text) ||
    text.toLowerCase().includes("unauthorized") ||
    text.toLowerCase().includes("invalid token")
  ) {
    return `provider:${namespace}: API token rejected — check PROVIDER_VERCEL_${namespace}_API_KEY.`;
  }
  return `provider:${namespace}: ${text}`;
}

export function formatPermissionHint(error: string): string {
  if (error.includes("403") || error.toLowerCase().includes("forbidden")) {
    return `${error.split(":")[0]} — API token is missing permission (got 403)`;
  }
  return error;
}
