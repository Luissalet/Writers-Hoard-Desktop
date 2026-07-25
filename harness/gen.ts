import { getWorld } from './world-cache';
const seed = process.argv[2] || 'monstruo';
const width = Number(process.argv[3] || 1024);
const w = getWorld({ seed, width });
let land=0; for (let i=0;i<w.elevation.length;i++) if (w.elevation[i]>0) land++;
console.log(`ok ${w.width}x${w.height} land ${(100*land/w.elevation.length).toFixed(1)}% rivers ${w.rivers.length} landmarks ${w.landmarks.length}`);
