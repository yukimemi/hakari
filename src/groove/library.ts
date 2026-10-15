// Songs and the chosen character, kept on this device only.
//
// The program for a song lives in Firestore so it follows the user to
// another device; the song itself never leaves this one. IndexedDB holds
// it so a program re-opens without picking the file again — but browsers
// may clear site storage (Safari does after a week without a visit unless
// the app is on the home screen), so this is a cache: when the song is
// gone the user picks the file again and the SHA-256 matches it back up
// with its program.

const DB_NAME = "hakari-groove";
const DB_VERSION = 1;
const SONGS = "songs";
const CHARACTER = "character";
/** Songs kept; the least recently played go first. A song is a few MB. */
export const MAX_SONGS = 12;

type StoredSong = { id: string; name: string; blob: Blob; usedAt: number };
type StoredCharacter = { id: "current"; name: string; blob: Blob };

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SONGS, { keyPath: "id" });
      request.result.createObjectStore(CHARACTER, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((err: unknown) => {
    opening = null;
    throw err;
  });
  return opening;
}

/** Runs one transaction and resolves with what `work` produced once it has
 *  committed — not when the request succeeded, which is before. */
async function transact<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const request = work(tx);
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Hex SHA-256 of the file: the song's id here and in Firestore. */
export async function songId(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function putSong(id: string, file: Blob, name: string): Promise<void> {
  // Ask once to be exempt from eviction. Browsers that ignore it (or say
  // no) are why everything here is treated as a cache.
  void navigator.storage?.persist?.().catch(() => false);
  await transact([SONGS], "readwrite", (tx) => {
    tx.objectStore(SONGS).put({ id, name, blob: file, usedAt: Date.now() } satisfies StoredSong);
  });
  await prune();
}

export async function getSong(id: string): Promise<{ name: string; blob: Blob } | undefined> {
  const song = (await transact([SONGS], "readonly", (tx) => tx.objectStore(SONGS).get(id))) as
    | StoredSong
    | undefined;
  if (!song) return undefined;
  await transact([SONGS], "readwrite", (tx) => {
    tx.objectStore(SONGS).put({ ...song, usedAt: Date.now() });
  });
  return { name: song.name, blob: song.blob };
}

export async function deleteSong(id: string): Promise<void> {
  await transact([SONGS], "readwrite", (tx) => {
    tx.objectStore(SONGS).delete(id);
  });
}

async function prune(): Promise<void> {
  const all = ((await transact([SONGS], "readonly", (tx) => tx.objectStore(SONGS).getAll())) ??
    []) as StoredSong[];
  const stale = all.sort((a, b) => b.usedAt - a.usedAt).slice(MAX_SONGS);
  if (!stale.length) return;
  await transact([SONGS], "readwrite", (tx) => {
    for (const song of stale) tx.objectStore(SONGS).delete(song.id);
  });
}

/** The .vrm the user chose to perform the program. */
export async function getCharacter(): Promise<{ name: string; blob: Blob } | undefined> {
  const stored = (await transact([CHARACTER], "readonly", (tx) =>
    tx.objectStore(CHARACTER).get("current"),
  )) as StoredCharacter | undefined;
  return stored && { name: stored.name, blob: stored.blob };
}

export async function putCharacter(file: Blob, name: string): Promise<void> {
  await transact([CHARACTER], "readwrite", (tx) => {
    tx.objectStore(CHARACTER).put({ id: "current", name, blob: file } satisfies StoredCharacter);
  });
}

export async function clearCharacter(): Promise<void> {
  await transact([CHARACTER], "readwrite", (tx) => {
    tx.objectStore(CHARACTER).delete("current");
  });
}
