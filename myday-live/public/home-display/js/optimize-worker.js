// Decodes and re-encodes photos off the main thread so imports of thousands
// of images do not stall the running slideshow.
import { optimizeImage } from './optimize-core.js';

self.onmessage = async ({ data }) => {
  const { id, file, maxEdge, thumbEdge } = data;
  try {
    const out = await optimizeImage(file, { maxEdge, thumbEdge });
    self.postMessage({ id, ...out });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
