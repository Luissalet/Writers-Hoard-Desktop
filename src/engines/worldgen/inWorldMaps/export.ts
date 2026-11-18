import { PLATE_WIDTH } from './plate';

import type { PlateFormat } from './types';

export async function rasterizePlate(svg: string, height: number, width = 1800): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round(height * width / PLATE_WIDTH);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Map canvas unavailable');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}

export async function exportPlate(plate: { svg: string; height: number }, title: string, format: PlateFormat) {
  const stem = title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'map';
  const filename = stem + '.' + format;
  if (format === 'svg') return { filename, blob: new Blob([plate.svg], { type: 'image/svg+xml;charset=utf-8' }) };
  const canvas = await rasterizePlate(plate.svg, plate.height);
  if (format === 'png') {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Map image unavailable');
    return { filename, blob };
  }
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const width = 720, height = width * canvas.height / canvas.width;
  const page = pdf.addPage([width, height]);
  page.drawImage(await pdf.embedPng(canvas.toDataURL('image/png')), { x: 0, y: 0, width, height });
  return { filename, blob: new Blob([new Uint8Array(await pdf.save()).buffer], { type: 'application/pdf' }) };
}
