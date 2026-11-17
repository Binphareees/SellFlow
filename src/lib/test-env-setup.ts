/**
 * Test-only helpers for setting process.env before loading modules that
 * validate their environment at import time.
 *
 * This is intentionally small and never used in production code.
 */

type EnvPatch = Record<string, string>;

export function setGlobalEnvForTest(patch: EnvPatch): void {
  for (const [key, value] of Object.entries(patch)) {
    process.env[key] = value;
  }
}

export function clearPatchedEnv(keys: string[]): void {
  for (const key of keys) {
    delete process.env[key];
  }
}
