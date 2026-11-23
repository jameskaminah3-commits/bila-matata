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
  const { canvas, context } = whiteCanvas(side, side);
  const picture = await openPicture(file);
  const inner = side * 0.92;
  const scale = Math.min(inner / picture.width, inner / picture.height);
  const w = Math.round(picture.width * scale);
  const h = Math.round(picture.height * scale);
  context.drawImage(picture.source, Math.round((side - w) / 2), Math.round((side - h) / 2), w, h);
  picture.release();
  return jpeg(canvas, file.name);
}

/** A section's banner is this size, in pixels. */
export const BANNER_WIDTH = 1200;
export const BANNER_HEIGHT = 480;

/**
 * A section's banner from any image the browser can open: the whole
 * picture, never cropped or stretched, centred in a 1200 × 480 strip whose
 * edges are a soft, darkened, blurred copy of the same picture, so it fills
 * the banner without bars. Saved as a JPG under 900 KB.
 */
export async function bannerPhoto(file: File): Promise<File> {
  const { canvas, context } = whiteCanvas(BANNER_WIDTH, BANNER_HEIGHT);
  const picture = await openPicture(file);
  const cover = Math.max(BANNER_WIDTH / picture.width, BANNER_HEIGHT / picture.height) * 1.15;
  context.filter = "blur(28px) brightness(0.75)";
  context.drawImage(picture.source, (BANNER_WIDTH - picture.width * cover) / 2, (BANNER_HEIGHT - picture.height * cover) / 2, picture.width * cover, picture.height * cover);
  context.filter = "none";
  const fit = Math.min(BANNER_WIDTH / picture.width, BANNER_HEIGHT / picture.height);
  const w = Math.round(picture.width * fit);
  const h = Math.round(picture.height * fit);
  context.drawImage(picture.source, Math.round((BANNER_WIDTH - w) / 2), Math.round((BANNER_HEIGHT - h) / 2), w, h);
  picture.release();
  return jpeg(canvas, file.name);
}

function whiteCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return { canvas, context };
}

/** Any image the browser can open (JPG, PNG, WebP, GIF, BMP, AVIF, SVG; HEIC where the browser reads it), ready to draw. */
async function openPicture(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    // SVG and other kinds createImageBitmap doesn't take: through an <img>.
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth || 1000, height: image.naturalHeight || 1000, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("This picture can't be opened here. Save it as a JPG or PNG and choose it again.");
  }
}

async function jpeg(canvas: HTMLCanvasElement, name: string): Promise<File> {
  for (const quality of [0.9, 0.85, 0.8, 0.7]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && (blob.size <= 900 * 1024 || quality === 0.7)) return new File([blob], `${name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" });
  }
  throw new Error("This picture can't be prepared here. Try another, or save it as a JPG.");
}
