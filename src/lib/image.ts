// Client-side image preparation.
//
// Phone cameras produce 4-12MB JPEGs. Vercel caps a request body at
// 4.5MB and base64 inflates by a third, so a raw upload would fail on the
// most common path through the app. Downscaling also cuts the vision
// token bill roughly in half with no measurable loss in portion-estimate
// quality — 1280px is well past what the models resolve internally.

export type PreparedImage = {
  base64: string;
  mediaType: "image/jpeg";
  /** Object URL for previewing. Caller revokes it. */
  previewUrl: string;
  /** The downscaled bytes, for uploading to Storage. */
  blob: Blob;
  width: number;
  height: number;
};

const MAX_EDGE = 1280;
const QUALITY = 0.82;

export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像の変換に失敗しました (canvas 未対応)");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("画像の変換に失敗しました"))),
      "image/jpeg",
      QUALITY,
    );
  });

  return {
    base64: await blobToBase64(blob),
    mediaType: "image/jpeg",
    previewUrl: URL.createObjectURL(blob),
    blob,
    width,
    height,
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Chunked to avoid blowing the argument limit on String.fromCharCode
  // for multi-megabyte images.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
