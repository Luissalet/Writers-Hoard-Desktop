import type { BoardShape } from './types';
export const BOARD_SHAPES: BoardShape[] = ['rectangle','circle','diamond','pill','hexagon','arrow','line','ellipse','oval','triangle','rhombus','pentagon','octagon','star','heart','cloud'];
const polygon=(count:number,inner?:number)=>Array.from({length:inner?count*2:count},(_,i)=>{const angle=-Math.PI/2+i*Math.PI*2/(inner?count*2:count),r=inner&&i%2?inner:46;return `${i?'L':'M'} ${50+Math.cos(angle)*r} ${50+Math.sin(angle)*r}`;}).join(' ')+' Z';
/** Normalized native geometry; nodes, resize, SVG export and APIs share it. */
export function boardShapePath(shape:BoardShape):string{
  switch(shape){
    case 'line':return 'M 4 50 L 96 50';
    case 'arrow':return 'M 4 50 L 96 50 M 76 30 L 96 50 L 76 70';
    case 'circle':case 'ellipse':return 'M 50 4 A 46 46 0 1 1 49.99 4 Z';
    case 'oval':case 'pill':return 'M 26 4 H 74 A 22 46 0 0 1 74 96 H 26 A 22 46 0 0 1 26 4 Z';
    case 'triangle':return polygon(3);
    case 'diamond':return 'M 50 4 L 96 50 L 50 96 L 4 50 Z';
    case 'rhombus':return 'M 24 4 H 96 L 76 96 H 4 Z';
    case 'pentagon':return polygon(5);
    case 'hexagon':return polygon(6);
    case 'octagon':return polygon(8);
    case 'star':return polygon(5,21);
    case 'heart':return 'M 50 92 C 20 72 0 48 7 25 C 14 4 40 2 50 23 C 60 2 86 4 93 25 C 100 48 80 72 50 92 Z';
    case 'cloud':return 'M 25 84 C 2 84 0 56 18 48 C 10 25 31 11 48 23 C 62 0 91 14 85 38 C 108 44 101 75 85 77 C 77 96 54 96 46 84 Z';
    default:return 'M 10 4 H 90 Q 96 4 96 10 V 90 Q 96 96 90 96 H 10 Q 4 96 4 90 V 10 Q 4 4 10 4 Z';
  }
}
const es:Record<BoardShape,string>={rectangle:'Rectángulo',circle:'Círculo',diamond:'Diamante',pill:'Cápsula',hexagon:'Hexágono',arrow:'Flecha',line:'Línea',ellipse:'Elipse',oval:'Óvalo',triangle:'Triángulo',rhombus:'Romboide',pentagon:'Pentágono',octagon:'Octágono',star:'Estrella',heart:'Corazón',cloud:'Nube'};
export const boardShapeLabel=(shape:BoardShape,locale:string)=>locale==='es'?es[shape]:shape[0].toUpperCase()+shape.slice(1);
