// Shrinks a receipt photo in the browser before upload: longest side <= 2000 px, JPEG, EXIF rotation applied.
import { fitSize, photoFits } from '../../shared/receiptDraft.ts';

export class PhotoError extends Error {
  constructor(readonly kind: 'open' | 'tooLarge') {
    super(kind);
  }
}

export interface PreparedPhoto {
  /** Base64 without the data: prefix. */
  base64: string;
  mediaType: 'image/jpeg';
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

async function decode(file: Blob): Promise<Decoded> {
  // createImageBitmap bakes the EXIF orientation into the pixels (what the canvas then draws).
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // older WebViews: no options argument or no support for the format; try <img> below
    }
  }
  // Fallback: <img>. Current engines apply EXIF orientation to images (image-orientation: from-image is the default).
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function prepareReceiptPhoto(file: Blob): Promise<PreparedPhoto> {
  let decoded: Decoded;
  try {
    decoded = await decode(file);
  } catch {
    throw new PhotoError('open');
  }
  try {
    if (!decoded.width || !decoded.height) throw new PhotoError('open');
    // Try the usual size at quality 0.8; if the file is still too big, shrink further.
    for (const [max, quality] of [
      [2000, 0.8],
      [2000, 0.65],
      [1600, 0.65],
      [1200, 0.6],
    ] as const) {
      const { width, height } = fitSize(decoded.width, decoded.height, max);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new PhotoError('open');
      ctx.fillStyle = '#fff'; // transparent PNGs would turn black in JPEG otherwise
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(decoded.source, 0, 0, width, height);
      const blob = await toBlob(canvas, quality);
      if (!blob) throw new PhotoError('open');
      if (photoFits(blob.size)) return { base64: await toBase64(blob), mediaType: 'image/jpeg' };
    }
    throw new PhotoError('tooLarge');
  } finally {
    decoded.close();
  }
}
