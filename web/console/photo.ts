// web/console/photo.ts
//
// Photos from a phone are big (3–6 MB). Before uploading, they're made the
// right size in the browser: the longest side at most maxSide pixels, as a
// JPEG (or WebP for a logo, which may be see-through). Small pictures go as
// they are. Turned the right way up from the camera's own note.

export async function shrinkPhoto(file: File, options: { maxSide?: number; maxBytes?: number; keepTransparency?: boolean } = {}): Promise<File> {
  const maxSide = options.maxSide ?? 1280;
  const maxBytes = options.maxBytes ?? 900 * 1024;
  if (file.size <= maxBytes && /^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const type = options.keepTransparency ? "image/webp" : "image/jpeg";
  for (const quality of [0.85, 0.75, 0.65, 0.55]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (blob && (blob.size <= maxBytes || quality === 0.55)) return new File([blob], file.name.replace(/\.[^.]+$/, "") + (type === "image/webp" ? ".webp" : ".jpg"), { type });
  }
  return file;
}
