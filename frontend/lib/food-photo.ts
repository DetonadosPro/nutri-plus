const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 768;
const JPEG_QUALITY = 0.8;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function aborted() {
  return new DOMException('A análise foi cancelada.', 'AbortError');
}

async function loadImage(file: File, signal?: AbortSignal) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image();
      const cancel = () => {
        image.src = '';
        reject(aborted());
      };
      signal?.addEventListener('abort', cancel, { once: true });
      image.onload = () => {
        signal?.removeEventListener('abort', cancel);
        resolve(image);
      };
      image.onerror = () => {
        signal?.removeEventListener('abort', cancel);
        reject(new Error('Não foi possível abrir esta foto.'));
      };
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function optimizeFoodPhoto(file: File, signal?: AbortSignal) {
  if (!ALLOWED_TYPES.has(file.type) || file.size > MAX_SOURCE_BYTES) {
    throw new Error('Escolha uma foto JPEG, PNG ou WebP de até 20 MB.');
  }
  if (signal?.aborted) throw aborted();

  const image = await loadImage(file, signal);
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('Foto inválida.');
  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Não foi possível preparar esta foto.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const compressed = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Não foi possível preparar esta foto.')),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
  if (signal?.aborted) throw aborted();

  const upload = file.size <= MAX_UPLOAD_BYTES && file.size <= compressed.size ? file : compressed;
  if (upload.size > MAX_UPLOAD_BYTES) throw new Error('A foto continuou muito grande após a otimização.');
  if (upload instanceof File) return upload;
  const name = file.name.replace(/\.[^.]+$/, '') || 'prato';
  return new File([upload], `${name}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
}
