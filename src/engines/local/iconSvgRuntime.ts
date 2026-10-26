import {createLocalToolIcons} from './icons';

/** Application binding: metadata stays pure; only a known SVG request loads graphics. */
export function createRuntimeLocalToolIcons(){
 return createLocalToolIcons(async id=>{
  const {resolveLocalToolIconSvg}=await import('./iconSvg');
  return resolveLocalToolIconSvg(id);
 });
}
