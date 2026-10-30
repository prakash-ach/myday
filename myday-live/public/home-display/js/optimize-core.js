// Shared by the worker and the main-thread fallback.
// Produces a display rendition (long edge ≤ maxEdge) and a thumbnail.

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toJpeg(canvas, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encode failed'))), 'image/jpeg', quality));
}

async function render(bitmap, edge, quality) {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await toJpeg(canvas, quality);
  return { blob, w, h };
}

export async function optimizeImage(file, { maxEdge = 2560, thumbEdge = 320 } = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This image format can’t be read by this browser');
  }
  try {
    const full = await render(bitmap, maxEdge, 0.88);
    const thumb = await render(bitmap, thumbEdge, 0.78);
    return { full: full.blob, thumb: thumb.blob, width: full.w, height: full.h };
  } finally {
    bitmap.close();
  }
}
