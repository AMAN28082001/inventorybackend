/** Tiny in-process TTL cache for auth / actor lookups. */

type Box<T> = { value: T; expiresAt: number };

const store = new Map<string, Box<unknown>>();
const DEFAULT_TTL_MS = 15_000;
const MAX_ENTRIES = 2000;

const sweep = (now: number): void => {
  for (const [key, box] of store) {
    if (box.expiresAt <= now) store.delete(key);
  }
  if (store.size > MAX_ENTRIES) store.clear();
};

export const ttlGet = <T>(key: string): T | undefined => {
  const box = store.get(key) as Box<T> | undefined;
  if (!box) return undefined;
  if (box.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return box.value;
};

export const ttlSet = <T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void => {
  const now = Date.now();
  if (store.size >= MAX_ENTRIES) sweep(now);
  store.set(key, { value, expiresAt: now + Math.max(1000, ttlMs) });
};

export const cachedLookup = async <T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs?: number
): Promise<T> => {
  const hit = ttlGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  ttlSet(key, value, ttlMs);
  return value;
};
