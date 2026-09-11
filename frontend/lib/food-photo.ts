const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 768;
const JPEG_QUALITY = 0.8;
const MAX_SOURCE_PIXELS = 64_000_000;
const MAX_FALLBACK_PIXELS = 24_000_000;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type PhotoDimensions = { width: number; height: number };
export type PhotoOptimizationStage = (
  event: string,
  details?: Record<string, string | number | boolean | null>,
) => void;

function aborted() {
  return new DOMException('A análise foi cancelada.', 'AbortError');
}

async function loadImage(file: File, signal?: AbortSignal) {
  const url = URL.createObjectURL(file);
  const image = new window.Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        image.src = '';
        reject(aborted());
      };
      signal?.addEventListener('abort', cancel, { once: true });
      image.onload = () => {
        signal?.removeEventListener('abort', cancel);
        resolve();
      };
      image.onerror = () => {
        signal?.removeEventListener('abort', cancel);
        reject(new Error('Não foi possível abrir esta foto.'));
      };
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function jpegDimensions(bytes: Uint8Array): PhotoDimensions | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sof = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker == null || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (sof.has(marker) && length >= 7) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += length;
  }
  return null;
}

function jpegOrientation(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 10 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker == null || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    const payload = offset + 2;
    if (
      marker === 0xe1 &&
      length >= 16 &&
      String.fromCharCode(...bytes.slice(payload, payload + 6)) === 'Exif\0\0'
    ) {
      const tiff = payload + 6;
      const littleEndian = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
      const bigEndian = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
      if (!littleEndian && !bigEndian) return 1;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const ifd = tiff + view.getUint32(tiff + 4, littleEndian);
      if (ifd + 2 > bytes.length) return 1;
      const entries = view.getUint16(ifd, littleEndian);
      for (let index = 0; index < entries; index += 1) {
        const entry = ifd + 2 + index * 12;
        if (entry + 12 > bytes.length) return 1;
        if (view.getUint16(entry, littleEndian) === 0x0112) {
          const value = view.getUint16(entry + 8, littleEndian);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
    }
    offset += length;
  }
  return 1;
}

export function orientPhotoDimensions(
  dimensions: PhotoDimensions,
  orientation: number,
) {
  return orientation >= 5 && orientation <= 8
    ? { width: dimensions.height, height: dimensions.width }
    : dimensions;
}

function pngDimensions(bytes: Uint8Array): PhotoDimensions | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value))
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function webpDimensions(bytes: Uint8Array): PhotoDimensions | null {
  if (
    bytes.length < 30 ||
    String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' ||
    String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP'
  )
    return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === 'VP8X') {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height:
        1 +
        ((bytes[22] & 0xc0) >> 6) +
        (bytes[23] << 2) +
        ((bytes[24] & 0x0f) << 10),
    };
  }
  if (
    chunk === 'VP8 ' &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }
  return null;
}

export async function readPhotoDimensions(file: File) {
  const bytes = new Uint8Array(
    await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer(),
  );
  if (file.type === 'image/jpeg') {
    const dimensions = jpegDimensions(bytes);
    return dimensions
      ? orientPhotoDimensions(dimensions, jpegOrientation(bytes))
      : null;
  }
  if (file.type === 'image/png') return pngDimensions(bytes);
  if (file.type === 'image/webp') return webpDimensions(bytes);
  return null;
}

export function photoResizeTarget({ width, height }: PhotoDimensions) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: scale < 1,
  };
}

export function canReuseOriginalPhoto(
  source: { size: number },
  compressed: { size: number },
  dimensions: PhotoDimensions,
) {
  return (
    Math.max(dimensions.width, dimensions.height) <= MAX_SIDE &&
    source.size <= MAX_UPLOAD_BYTES &&
    source.size <= compressed.size
  );
}

export async function optimizeFoodPhoto(
  file: File,
  signal?: AbortSignal,
  onStage: PhotoOptimizationStage = () => undefined,
) {
  if (!ALLOWED_TYPES.has(file.type) || file.size > MAX_SOURCE_BYTES) {
    throw new Error('Escolha uma foto JPEG, PNG ou WebP de até 20 MB.');
  }
  if (signal?.aborted) throw aborted();
  onStage('source received', { sourceBytes: file.size, sourceType: file.type });

  let dimensions = await readPhotoDimensions(file);
  let image: HTMLImageElement | null = null;
  let bitmap: ImageBitmap | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    if (dimensions) {
      const pixels = dimensions.width * dimensions.height;
      if (!dimensions.width || !dimensions.height || pixels > MAX_SOURCE_PIXELS)
        throw new Error('Esta foto tem resolução acima do limite de 64 megapixels.');
    }

    let target = dimensions ? photoResizeTarget(dimensions) : null;
    if (target?.scaled && typeof createImageBitmap === 'function') {
      try {
        const candidate = await createImageBitmap(file, {
          imageOrientation: 'from-image',
          resizeWidth: target.width,
          resizeHeight: target.height,
          resizeQuality: 'high',
        });
        if (candidate.width === target.width && candidate.height === target.height) {
          bitmap = candidate;
          onStage('decode complete', {
            decoder: 'ImageBitmap resized',
            sourceWidth: dimensions!.width,
            sourceHeight: dimensions!.height,
            targetWidth: bitmap.width,
            targetHeight: bitmap.height,
          });
        } else {
          const returnedWidth = candidate.width;
          const returnedHeight = candidate.height;
          candidate.close();
          onStage('decode resize unavailable', {
            returnedWidth,
            returnedHeight,
          });
        }
      } catch (reason) {
        if (signal?.aborted) throw aborted();
        onStage('decode resize unavailable', {
          name: reason instanceof Error ? reason.name : 'Error',
        });
      }
    }
    if (!bitmap) {
      if (
        dimensions &&
        dimensions.width * dimensions.height > MAX_FALLBACK_PIXELS
      ) {
        throw new Error(
          'Este navegador não consegue reduzir esta foto grande com segurança. Atualize o navegador e tente novamente.',
        );
      }
      image = await loadImage(file, signal);
      dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      if (!dimensions.width || !dimensions.height) throw new Error('Foto inválida.');
      const pixels = dimensions.width * dimensions.height;
      if (pixels > MAX_SOURCE_PIXELS)
        throw new Error('Esta foto tem resolução acima do limite de 64 megapixels.');
      target = photoResizeTarget(dimensions);
      onStage('decode complete', {
        decoder: 'HTMLImageElement fallback',
        sourceWidth: dimensions.width,
        sourceHeight: dimensions.height,
        targetWidth: target.width,
        targetHeight: target.height,
      });
    }
    if (signal?.aborted) throw aborted();

    canvas = document.createElement('canvas');
    canvas.width = bitmap?.width ?? target!.width;
    canvas.height = bitmap?.height ?? target!.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Não foi possível preparar esta foto.');
    context.drawImage(bitmap ?? image!, 0, 0, canvas.width, canvas.height);
    const compressed = await new Promise<Blob>((resolve, reject) => {
      canvas!.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error('Não foi possível preparar esta foto.')),
        'image/jpeg',
        JPEG_QUALITY,
      );
    });
    if (signal?.aborted) throw aborted();

    const reuseOriginal = canReuseOriginalPhoto(file, compressed, dimensions!);
    const upload = reuseOriginal ? file : compressed;
    if (upload.size > MAX_UPLOAD_BYTES)
      throw new Error('A foto continuou muito grande após a otimização.');
    onStage('resize complete', {
      uploadBytes: upload.size,
      uploadWidth: canvas.width,
      uploadHeight: canvas.height,
      reusedOriginal: reuseOriginal,
    });
    if (upload instanceof File) return upload;
    const name = file.name.replace(/\.[^.]+$/, '') || 'prato';
    return new File([upload], `${name}.jpg`, {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } finally {
    bitmap?.close();
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
    }
    if (canvas) {
      const context = canvas.getContext('2d');
      context?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 1;
      canvas.height = 1;
    }
    onStage('decode surfaces released');
  }
}
