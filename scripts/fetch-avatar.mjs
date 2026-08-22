// Fetches the default trainer avatar.
//
// The model is not committed. Its licence allows use and modification
// freely, but this repository is public and vendoring a 7.6MB character
// here would be redistributing someone else's work — so it is downloaded
// on demand instead. The app falls back to its own capsule mannequin when
// the file is absent, so this is optional.
//
//   pnpm run avatar
//
// アリシア・ソリッド (VRM 0.51), taken from the VRM Consortium's UniVRM
// repository where it ships as a test model. Terms:
// https://3d.nicovideo.jp/alicia/rule.html — free, no credit required,
// modification allowed, commercial use allowed except by corporations.

import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const URL_ =
  "https://raw.githubusercontent.com/vrm-c/UniVRM/master/Tests/Models/Alicia_vrm-0.51/AliciaSolid_vrm-0.51.vrm";
const DEST = "public/avatars/trainer.vrm";

const already = await stat(DEST).catch(() => null);
if (already) {
  console.log(`${DEST} already exists (${(already.size / 1e6).toFixed(1)}MB)`);
  process.exit(0);
}

console.log(`downloading ${URL_}`);
const response = await fetch(URL_);
if (!response.ok || !response.body) {
  console.error(`failed: HTTP ${response.status}`);
  process.exit(1);
}

await mkdir(dirname(DEST), { recursive: true });
await pipeline(Readable.fromWeb(response.body), createWriteStream(DEST));

const written = await stat(DEST);
console.log(`saved ${DEST} (${(written.size / 1e6).toFixed(1)}MB)`);
