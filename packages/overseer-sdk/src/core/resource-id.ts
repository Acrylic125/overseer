export function resourceId(
  provider: string,
  ...parts: string[]
): `${string}:${string}` {
  return `${provider}:${parts.join(":")}`;
}
