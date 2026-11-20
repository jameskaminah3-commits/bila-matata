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

/** Every catalogue picture is this square, in pixels. */
export const ITEM_PHOTO_SIDE = 1000;

/**
 * A catalogue picture from any image the browser can open (JPG, PNG, WebP,
 * GIF, BMP, AVIF, SVG; HEIC where the browser reads it): the whole picture,
 * never cropped or stretched, centred in a 1000 × 1000 white square with a
 * small even margin, saved as a JPG under 900 KB. Transparent parts become
 * white. Every item's picture then has the same shape and size, whatever
 * was chosen.
 */
export async function squarePhoto(file: File): Promise<File> {
  const side = ITEM_PHOTO_SIDE;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, side, side);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const draw = (source: CanvasImageSource, width: number, height: number) => {
    const inner = side * 0.92;
    const scale = Math.min(inner / width, inner / height);
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    context.drawImage(source, Math.round((side - w) / 2), Math.round((side - h) / 2), w, h);
  };
  let drawn = false;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    draw(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
    drawn = true;
  } catch {
    // SVG and other kinds createImageBitmap doesn't take: through an <img>.
  }
  if (!drawn) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      draw(image, image.naturalWidth || side, image.naturalHeight || side);
    } catch {
      throw new Error("This picture can't be opened here. Save it as a JPG or PNG and choose it again.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  for (const quality of [0.9, 0.85, 0.8, 0.7]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && (blob.size <= 900 * 1024 || quality === 0.7)) return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" });
  }
  throw new Error("This picture can't be prepared here. Try another, or save it as a JPG.");
}
