// web/console/card-export.ts
//
// Turning a business card (the exact vector pictures the server draws) into
// files, in the browser:
//
//   printSheetPdf   A4, ten cards a page (fronts, then backs: print both
//                   sides, flipping on the long edge), with cut marks and a
//                   3 mm bleed on the outer edges, at 450 dpi
//   printShopPdf    one card per page at 91 × 61 mm (85 × 55 plus 3 mm
//                   bleed), front then back, at 600 dpi, with its trim box
//                   marked: what print shops ask for
//   cardPng         one side at 600 dpi, to keep or send
//   shareImage      both sides on a soft ground, sized for WhatsApp and
//                   social posts
//
// The PDFs are written here: each page is one high-resolution picture.

const MM_PER_INCH = 25.4;
const PT_PER_MM = 72 / MM_PER_INCH;
const CARD = { width: 85, height: 55, bleed: 3 };

/** The card's SVG, drawn at a size in pixels. */
async function picture(svg: string, width: number, height: number): Promise<HTMLImageElement> {
  const sized = svg.replace(/width="[\d.]+mm" height="[\d.]+mm"/, `width="${width}" height="${height}"`);
  const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  return [canvas, context];
}

const blobOf = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture couldn't be made."))), type, quality));

// ── A small PDF writer: pages that are each one JPEG picture ──────────────
type PdfPage = { widthMm: number; heightMm: number; jpeg: Uint8Array; pixelsWide: number; pixelsHigh: number; trimMm?: number };

export function pdfOf(pages: PdfPage[], title: string): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: () => void) => {
    offsets[id] = length;
    write(`${id} 0 obj\n`);
    body();
    write("\nendobj\n");
  };
  const n = (value: number) => Number(value.toFixed(3)).toString();
  const safe = (value: string) => value.replace(/[\\()]/g, (char) => `\\${char}`).replace(/[^\x20-\x7e]/g, "");
  write("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const pageIds = pages.map((_, index) => 4 + index * 3);
  object(1, () => write("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () => write(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`));
  object(3, () => write(`<< /Title (${safe(title)}) /Producer (Zaina by Bila Matata) >>`));
  pages.forEach((page, index) => {
    const id = pageIds[index];
    const width = page.widthMm * PT_PER_MM;
    const height = page.heightMm * PT_PER_MM;
    const trim = (page.trimMm ?? 0) * PT_PER_MM;
    const boxes = trim ? ` /BleedBox [0 0 ${n(width)} ${n(height)}] /TrimBox [${n(trim)} ${n(trim)} ${n(width - trim)} ${n(height - trim)}]` : "";
    object(id, () => write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(width)} ${n(height)}]${boxes} /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`));
    const content = `q ${n(width)} 0 0 ${n(height)} 0 0 cm /Im0 Do Q`;
    object(id + 1, () => write(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    object(id + 2, () => {
      write(`<< /Type /XObject /Subtype /Image /Width ${page.pixelsWide} /Height ${page.pixelsHigh} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`);
      write(page.jpeg);
      write("\nendstream");
    });
  });
  const size = 4 + pages.length * 3;
  const xref = length;
  write(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (let id = 1; id < size; id += 1) write(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  write(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

async function jpegPage(canvas: HTMLCanvasElement, widthMm: number, heightMm: number, trimMm?: number): Promise<PdfPage> {
  const blob = await blobOf(canvas, "image/jpeg", 0.95);
  return { widthMm, heightMm, trimMm, jpeg: new Uint8Array(await blob.arrayBuffer()), pixelsWide: canvas.width, pixelsHigh: canvas.height };
}

// ── The files ─────────────────────────────────────────────────────────────

/** Front and back, each on its own page with a 3 mm bleed, at 600 dpi: for a print shop. */
export async function printShopPdf(frontWithBleed: string, backWithBleed: string, title: string): Promise<Blob> {
  const widthMm = CARD.width + CARD.bleed * 2;
  const heightMm = CARD.height + CARD.bleed * 2;
  const scale = 600 / MM_PER_INCH;
  const pages: PdfPage[] = [];
  for (const svg of [frontWithBleed, backWithBleed]) {
    const [canvas, context] = canvasOf(widthMm * scale, heightMm * scale);
    context.drawImage(await picture(svg, canvas.width, canvas.height), 0, 0, canvas.width, canvas.height);
    pages.push(await jpegPage(canvas, widthMm, heightMm, CARD.bleed));
  }
  return pdfOf(pages, title);
}

/** Two A4 pages of ten: fronts, then backs, with cut marks. */
export async function printSheetPdf(frontWithBleed: string, backWithBleed: string, title: string): Promise<Blob> {
  const scale = 450 / MM_PER_INCH;
  const page = { width: 210, height: 297 };
  const grid = { left: 20, top: 11, columns: 2, rows: 5 };
  const bleed = CARD.bleed;
  const pages: PdfPage[] = [];
  for (const svg of [frontWithBleed, backWithBleed]) {
    const [canvas, context] = canvasOf(page.width * scale, page.height * scale);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const card = await picture(svg, Math.round((CARD.width + bleed * 2) * scale), Math.round((CARD.height + bleed * 2) * scale));
    // Cell edges on whole pixels, so neighbouring cards meet without a seam.
    const px = (mm: number) => Math.round(mm * scale);
    const bleedPx = px(bleed);
    for (let row = 0; row < grid.rows; row += 1) {
      for (let column = 0; column < grid.columns; column += 1) {
        const x0 = px(grid.left + column * CARD.width);
        const x1 = px(grid.left + (column + 1) * CARD.width);
        const y0 = px(grid.top + row * CARD.height);
        const y1 = px(grid.top + (row + 1) * CARD.height);
        // Each card is cut to its own cell; on the sheet's outer edges it keeps its bleed.
        const left = column === 0 ? bleedPx : 0;
        const right = column === grid.columns - 1 ? bleedPx : 0;
        const top = row === 0 ? bleedPx : 0;
        const bottom = row === grid.rows - 1 ? bleedPx : 0;
        context.save();
        context.beginPath();
        context.rect(x0 - left, y0 - top, x1 - x0 + left + right, y1 - y0 + top + bottom);
        context.clip();
        context.drawImage(card, x0 - bleedPx, y0 - bleedPx, x1 - x0 + bleedPx * 2, y1 - y0 + bleedPx * 2);
        context.restore();
      }
    }
    // Cut marks, outside the bleed.
    context.strokeStyle = "#4b5563";
    context.lineWidth = 0.2 * scale;
    const gridRight = grid.left + grid.columns * CARD.width;
    const gridBottom = grid.top + grid.rows * CARD.height;
    context.beginPath();
    for (let column = 0; column <= grid.columns; column += 1) {
      const x = (grid.left + column * CARD.width) * scale;
      context.moveTo(x, 0);
      context.lineTo(x, (grid.top - bleed - 1.5) * scale);
      context.moveTo(x, (gridBottom + bleed + 1.5) * scale);
      context.lineTo(x, page.height * scale);
    }
    for (let row = 0; row <= grid.rows; row += 1) {
      const y = (grid.top + row * CARD.height) * scale;
      context.moveTo(0, y);
      context.lineTo((grid.left - bleed - 1.5) * scale, y);
      context.moveTo((gridRight + bleed + 1.5) * scale, y);
      context.lineTo(page.width * scale, y);
    }
    context.stroke();
    pages.push(await jpegPage(canvas, page.width, page.height));
  }
  return pdfOf(pages, title);
}

/** One side, at 600 dpi. */
export async function cardPng(svg: string): Promise<Blob> {
  const scale = 600 / MM_PER_INCH;
  const [canvas, context] = canvasOf(CARD.width * scale, CARD.height * scale);
  context.drawImage(await picture(svg, canvas.width, canvas.height), 0, 0, canvas.width, canvas.height);
  return blobOf(canvas, "image/png");
}

/** Both sides on a soft ground, 1600 × 2000: for WhatsApp, a status or a post. */
export async function shareImage(front: string, back: string): Promise<Blob> {
  const [canvas, context] = canvasOf(1600, 2000);
  const ground = context.createLinearGradient(0, 0, 0, 2000);
  ground.addColorStop(0, "#f5f3ee");
  ground.addColorStop(1, "#e6e2da");
  context.fillStyle = ground;
  context.fillRect(0, 0, 1600, 2000);
  const width = 1300;
  const height = Math.round(width * (CARD.height / CARD.width));
  const x = (1600 - width) / 2;
  const radius = 34;
  const place = async (svg: string, y: number) => {
    const card = await picture(svg, width * 2, height * 2);
    context.save();
    context.shadowColor = "rgba(20, 24, 22, 0.28)";
    context.shadowBlur = 70;
    context.shadowOffsetY = 34;
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.fillStyle = "#ffffff";
    context.fill();
    context.restore();
    context.save();
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.clip();
    context.drawImage(card, x, y, width, height);
    context.restore();
  };
  const gap = 110;
  const top = (2000 - height * 2 - gap) / 2;
  await place(front, top);
  await place(back, top + height + gap);
  return blobOf(canvas, "image/png");
}

/** Shares a file where the device can (WhatsApp and the rest); otherwise saves it. */
export async function shareOrSave(file: File, text: string, save: (name: string, blob: Blob) => void): Promise<"shared" | "saved"> {
  const data = { files: [file], text };
  if (typeof navigator.canShare === "function" && navigator.canShare(data)) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return "shared";
    }
  }
  save(file.name, file);
  return "saved";
}
