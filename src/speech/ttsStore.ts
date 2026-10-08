// Audio cache for Gemini speech.
//
// Reusable lines (counts, "next set", "rest") live in Cache Storage so they
// survive reloads and are generated once per voice setup. Anything personal
// stays in memory only: it is useless to the next session and should not
// sit on disk. When Cache Storage is unavailable (private mode, old
// browsers) everything quietly lives in memory instead.
//
// The key hashes profile + phase + text, so changing the model, the voice
// or the instruction wording makes old entries unreachable; the LRU then
// ages them out.

import type { TtsPhase } from "../../shared/tts";

const CACHE_NAME = "hakari-tts-v1";
const INDEX_KEY = "hakari.tts.index";
const PROFILE_KEY = "hakari.tts.profile";

export const MAX_ENTRIES = 80;
export const MAX_BYTES = 8_000_000;

type Index = Record<string, { bytes: number; used: number }>;

/** 53-bit string hash (cyrb53). Not cryptographic; only has to be stable. */
export function hashKey(profile: string, phase: TtsPhase, text: string): string {
  const input = `${profile}\n${phase}\n${text}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export type StoreDeps = {
  caches?: CacheStorage;
  storage?: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
  maxEntries?: number;
  maxBytes?: number;
};

export type TtsStore = {
  get(key: string): Promise<ArrayBuffer | undefined>;
  put(key: string, bytes: ArrayBuffer, persist: boolean): Promise<void>;
  has(key: string): boolean;
  profile(): string | undefined;
  setProfile(profile: string): void;
};

export function createTtsStore(deps: StoreDeps = {}): TtsStore {
  const now = deps.now ?? Date.now;
  const maxEntries = deps.maxEntries ?? MAX_ENTRIES;
  const maxBytes = deps.maxBytes ?? MAX_BYTES;
  const storage =
    deps.storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  const caches =
    deps.caches ?? (typeof globalThis.caches !== "undefined" ? globalThis.caches : undefined);

  const memory = new Map<string, ArrayBuffer>();
  let disk = caches !== undefined;
  let index: Index = {};
  try {
    index = JSON.parse(storage?.getItem(INDEX_KEY) ?? "{}") as Index;
  } catch {
    index = {};
  }

  const saveIndex = () => {
    try {
      storage?.setItem(INDEX_KEY, JSON.stringify(index));
    } catch {
      /* losing LRU order is harmless */
    }
  };
  const url = (key: string) => `/__tts__/${key}`;
  const open = async () => {
    try {
      return caches ? await caches.open(CACHE_NAME) : undefined;
    } catch {
      disk = false;
      return undefined;
    }
  };

  async function evict() {
    const keys = Object.keys(index);
    let total = keys.reduce((n, k) => n + index[k].bytes, 0);
    const oldest = keys.sort((a, b) => index[a].used - index[b].used);
    const cache = disk ? await open() : undefined;
    while (oldest.length && (oldest.length > maxEntries || total > maxBytes)) {
      const k = oldest.shift()!;
      total -= index[k].bytes;
      delete index[k];
      memory.delete(k);
      try {
        await cache?.delete(url(k));
      } catch {
        /* ignore */
      }
    }
    saveIndex();
  }

  return {
    has: (key) => memory.has(key) || key in index,

    async get(key) {
      const hot = memory.get(key);
      if (hot) {
        if (index[key]) index[key].used = now();
        return hot;
      }
      if (!disk || !(key in index)) return undefined;
      try {
        const hit = await (await open())?.match(url(key));
        if (!hit) {
          delete index[key];
          return undefined;
        }
        const bytes = await hit.arrayBuffer();
        index[key].used = now();
        memory.set(key, bytes);
        saveIndex();
        return bytes;
      } catch {
        return undefined;
      }
    },

    async put(key, bytes, persist) {
      memory.set(key, bytes);
      if (!persist) {
        // Memory-only audio is not in the index, so bound it here.
        const loose = [...memory.keys()].filter((k) => !(k in index));
        for (const k of loose.slice(0, Math.max(0, loose.length - 20))) memory.delete(k);
        return;
      }
      index[key] = { bytes: bytes.byteLength, used: now() };
      if (disk) {
        try {
          await (await open())?.put(url(key), new Response(bytes.slice(0)));
        } catch {
          disk = false;
        }
      }
      await evict();
    },

    profile() {
      try {
        return storage?.getItem(PROFILE_KEY) ?? undefined;
      } catch {
        return undefined;
      }
    },

    setProfile(profile) {
      try {
        storage?.setItem(PROFILE_KEY, profile);
      } catch {
        /* ignore */
      }
    },
  };
}
