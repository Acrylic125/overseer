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
