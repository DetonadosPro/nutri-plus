import { describe, expect, it, vi } from 'vitest';
import {
  canReuseOriginalPhoto,
  orientPhotoDimensions,
  photoResizeTarget,
  readPhotoDimensions,
} from './food-photo';
import {
  PhotoAnalysisGate,
  PhotoPreviewUrl,
  takePhotoInputFile,
} from './photo-session';

function pngFile(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new File([bytes], 'camera.png', { type: 'image/png' });
}

function orientedJpegFile(width: number, height: number, orientation: number) {
  const exif = [
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x22,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,
    orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ];
  const sof = [
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
  ];
  return new File([new Uint8Array([...exif, ...sof])], 'camera.jpg', {
    type: 'image/jpeg',
  });
}

describe('food photo memory boundaries', () => {
  it('reads dimensions without decoding the full PNG and targets 768 px', async () => {
    const dimensions = await readPhotoDimensions(pngFile(8000, 6000));
    expect(dimensions).toEqual({ width: 8000, height: 6000 });
    expect(photoResizeTarget(dimensions!)).toEqual({
      width: 768,
      height: 576,
      scaled: true,
    });
  });

  it('never keeps a high-resolution original based only on encoded bytes', () => {
    expect(
      canReuseOriginalPhoto(
        { size: 100_000 },
        { size: 200_000 },
        { width: 8000, height: 6000 },
      ),
    ).toBe(false);
    expect(
      canReuseOriginalPhoto(
        { size: 100_000 },
        { size: 200_000 },
        { width: 640, height: 480 },
      ),
    ).toBe(true);
  });

  it('swaps resize dimensions for rotated EXIF orientations', () => {
    expect(
      orientPhotoDimensions({ width: 4032, height: 3024 }, 6),
    ).toEqual({ width: 3024, height: 4032 });
    expect(
      orientPhotoDimensions({ width: 4032, height: 3024 }, 1),
    ).toEqual({ width: 4032, height: 3024 });
  });

  it('reads EXIF orientation before choosing the decode target', async () => {
    expect(await readPhotoDimensions(orientedJpegFile(4032, 3024, 6))).toEqual({
      width: 3024,
      height: 4032,
    });
  });

  it('aborts the prior analysis and rejects stale results', () => {
    const gate = new PhotoAnalysisGate();
    const first = gate.start();
    const second = gate.start();
    expect(first.controller.signal.aborted).toBe(true);
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
    gate.dispose();
    expect(second.controller.signal.aborted).toBe(true);
    expect(gate.isCurrent(second)).toBe(false);
  });

  it('keeps only one current analysis over ten consecutive captures', () => {
    const gate = new PhotoAnalysisGate();
    const analyses = Array.from({ length: 10 }, () => gate.start());
    expect(analyses.slice(0, -1).every((item) => item.controller.signal.aborted)).toBe(true);
    expect(gate.isCurrent(analyses.at(-1)!)).toBe(true);
    gate.cancel();
    expect(analyses.at(-1)!.controller.signal.aborted).toBe(true);
  });

  it('revokes previews when replaced and disposed', () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second');
    const revokeObjectURL = vi.fn();
    const owner = new PhotoPreviewUrl({ createObjectURL, revokeObjectURL });
    owner.replace(new Blob(['a']));
    owner.replace(new Blob(['b']));
    owner.clear();
    expect(revokeObjectURL.mock.calls).toEqual([
      ['blob:first'],
      ['blob:second'],
    ]);
    expect(owner.current()).toBe('');
  });

  it('resets the native file input before asynchronous processing', () => {
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    const input = { files: { 0: file, length: 1 } as unknown as FileList, value: 'C:\\fakepath\\photo.jpg' };
    expect(takePhotoInputFile(input)).toBe(file);
    expect(input.value).toBe('');
  });
});
