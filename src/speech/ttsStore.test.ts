import { describe, expect, it } from "vitest";
import { createTtsStore, hashKey } from "./ttsStore";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const bytes = (n: number) => new Uint8Array(n).buffer;

describe("hashKey", () => {
  it("changes with profile, phase and text", () => {
    const base = hashKey("m|v|1", "exercise", "いち");
    expect(hashKey("m|v|1", "exercise", "いち")).toBe(base);
    expect(hashKey("m|v2|1", "exercise", "いち")).not.toBe(base);
    expect(hashKey("m|v|1", "rest", "いち")).not.toBe(base);
    expect(hashKey("m|v|1", "exercise", "に")).not.toBe(base);
  });
});

describe("createTtsStore", () => {
  it("works in memory when Cache Storage is unavailable", async () => {
    const store = createTtsStore({ caches: undefined, storage: mem() });
    await store.put("a", bytes(10), true);
    expect((await store.get("a"))?.byteLength).toBe(10);
  });

  it("evicts least recently used past the entry limit", async () => {
    let t = 0;
    const store = createTtsStore({ storage: mem(), now: () => ++t, maxEntries: 2 });
    await store.put("a", bytes(1), true);
    await store.put("b", bytes(1), true);
    await store.get("a"); // a is now newer than b
    await store.put("c", bytes(1), true);
    expect(store.has("b")).toBe(false);
    expect(store.has("a")).toBe(true);
    expect(store.has("c")).toBe(true);
  });

  it("evicts past the byte limit", async () => {
    let t = 0;
    const store = createTtsStore({ storage: mem(), now: () => ++t, maxBytes: 25 });
    await store.put("a", bytes(10), true);
    await store.put("b", bytes(10), true);
    await store.put("c", bytes(10), true);
    expect(store.has("a")).toBe(false);
    expect(store.has("c")).toBe(true);
  });

  it("keeps non-persistent audio out of the index", async () => {
    const storage = mem();
    const store = createTtsStore({ storage });
    await store.put("p", bytes(5), false);
    expect((await store.get("p"))?.byteLength).toBe(5);
    expect(storage.getItem("hakari.tts.index")).toBeNull();
  });
});
