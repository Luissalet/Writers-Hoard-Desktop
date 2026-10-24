import type { Ctx } from './symbols';
import type { WorldSpatialStyle } from '../core/spatialEntities';
import { resolvePlaceCatalogIcon,hasCatalogPlaceIcon } from '../core/placeIconCatalog';
import {PLACE_ICON_DATA} from '../core/placeIconData';
import { symbolScale } from '../core/placeStyle';
import { placeImageRadius,type PlaceImagePainter } from './placeImages';

export function hasPlaceMarkerOverride(style:WorldSpatialStyle,painter?:PlaceImagePainter):boolean{return !!painter?.has(style)||hasCatalogPlaceIcon(style);}
/** Inputs and output use the caller's logical pixels; DPR/typeScale is supplied once. */
export function placeMarkerRadius(style:WorldSpatialStyle,legacyRadius:number,painter?:PlaceImagePainter,pixelScale=1):number {
  const imageRadius=placeImageRadius(style,legacyRadius,painter,pixelScale);
  return hasCatalogPlaceIcon(style)?Math.max(imageRadius,8*symbolScale(style)*pixelScale):imageRadius;
}
/** Trusted numeric primitives only. No SVG/path parsing or ambient browser API. */
export function drawPlaceCatalogIcon(ctx:Ctx,style:WorldSpatialStyle,radius:number,ink?:string):boolean {
  const descriptor=resolvePlaceCatalogIcon(style.catalogIcon);if(!descriptor)return false;
  const shapes=PLACE_ICON_DATA[descriptor.name];
  ctx.save();
  try{
    ctx.scale(radius/12,radius/12);ctx.translate(-12,-12);
    ctx.strokeStyle=style.color??ink??'#493e30';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=2;
    ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash([]);ctx.lineDashOffset=0;
    for(const[fill,ops]of shapes){ctx.beginPath();for(const op of ops){switch(op[0]){
      case'M':ctx.moveTo(op[1],op[2]);break;case'L':ctx.lineTo(op[1],op[2]);break;
      case'C':ctx.bezierCurveTo(op[1],op[2],op[3],op[4],op[5],op[6]);break;
      case'Q':ctx.quadraticCurveTo(op[1],op[2],op[3],op[4]);break;
      case'E':ctx.ellipse(op[1],op[2],op[3],op[4],op[5],op[6],op[7],op[8]===1);break;
      case'Z':ctx.closePath();break;
    }}if(fill===1)ctx.fill();ctx.stroke();}
  }finally{ctx.restore();}
  return true;
}
