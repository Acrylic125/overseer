import type { FieldValue } from "../types.js";

export type EnvVar = {
  key: string;
  value: string;
  type: string;
  target?: string[];
  gitBranch?: string;
};

function redactSensitiveValue(value: string) {
  if (value.length <= 6) return "******";
  return `${value.slice(0, 3)}******${value.slice(-3)}`;
}

function isPlainEnv(env: EnvVar) {
  const type = env.type.toLowerCase();
  return type === "plain" || type === "plain_text";
}

function fieldEnvValue(env: EnvVar) {
  if (isPlainEnv(env)) return env.value;
  return redactSensitiveValue(env.value);
}

export function envFields(envs: EnvVar[]) {
  const fields: Record<string, FieldValue | FieldValue[]> = {};
  for (const env of envs) {
    const key =
      env.gitBranch && env.gitBranch.length > 0
        ? `${env.key} [${env.gitBranch}]`
        : env.key;
    fields[key] = fieldEnvValue(env);
  }
  return fields;
}

export function envReferences(envs: EnvVar[]) {
  const env: Record<string, string> = {};
  for (const item of envs) {
    if (item.gitBranch && item.gitBranch.length > 0) {
      env[`${item.key} [${item.gitBranch}]`] = item.value;
    } else {
      env[item.key] = item.value;
    }
  }
  return Object.values(env);
}

export function parseEnvUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.includes("://")) {
      return new URL(trimmed);
    }
    return new URL(`https://${trimmed}`);
  } catch {
    return null;
  }
}

export function exposedByDomains(domains: string[], use: string) {
  const useHost = parseEnvUrl(use)?.hostname.toLowerCase();
  if (!useHost) {
    return { isConnected: false, label: "" };
  }
  for (const domain of domains) {
    const domainHost = parseEnvUrl(domain)?.hostname.toLowerCase();
    if (!domainHost) continue;
    if (domainHost === useHost) {
      return { isConnected: true, label: "Domain" };
    }
    if (domainHost.endsWith(`.${useHost}`)) {
      return { isConnected: true, label: "Domain" };
    }
    if (useHost.endsWith(`.${domainHost}`)) {
      return { isConnected: true, label: "Domain" };
    }
  }
  return { isConnected: false, label: "" };
}
