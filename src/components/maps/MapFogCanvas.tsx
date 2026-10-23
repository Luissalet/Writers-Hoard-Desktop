import { useEffect, useRef } from 'react';
import { fogAlpha, type MaskCells } from './mapExploration';

/** The fog over the picture: a coarse canvas stretched to the picture, so its edges are soft. */
export default function MapFogCanvas({ cells, cols, rows, opacity, players }: { cells: MaskCells; cols: number; rows: number; opacity: number; players: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext('2d');
    if (!context) return;
    const alpha = fogAlpha(cells, cols, rows), image = context.createImageData(cols, rows);
    for (let index = 0; index < alpha.length; index++) {
      image.data[index * 4] = 27; image.data[index * 4 + 1] = 22; image.data[index * 4 + 2] = 16;
      image.data[index * 4 + 3] = Math.round(alpha[index] * opacity);
    }
    context.putImageData(image, 0, 0);
  }, [cells, cols, rows, opacity]);
  return <canvas ref={ref} width={cols} height={rows} data-testid="map-fog-canvas" data-view={players ? 'players' : 'author'} aria-hidden="true" className="absolute inset-0 h-full w-full pointer-events-none" style={{ imageRendering: 'auto' }} />;
}
