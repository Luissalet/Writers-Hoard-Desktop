// Independent semantic regression oracles for graphic place markers.
const assert=require('node:assert/strict'),path=require('node:path'),{build}=require('esbuild'),{createCanvas}=require('@napi-rs/canvas');
async function main(){
 const root=process.cwd(),result=await build({stdin:{contents:"export {validatePlaceStyle,hasPlaceModel} from './src/engines/worldgen/core/placeStyle';export {drawPlaceBuilding} from './src/engines/worldgen/cartography/placeSymbol';",resolveDir:root},bundle:true,write:false,platform:'node',format:'cjs',alias:{'@':path.join(root,'src')},metafile:true,logLevel:'silent'});
 const badInputs=Object.keys(result.metafile.inputs).filter(file=>/node_modules[\\/](?:react|lucide-react)[\\/]|src[\\/]db[\\/]/.test(file));assert.deepEqual(badInputs,[],'Pure place renderer pulled UI/DB');
 const output={exports:{}};new Function('module','exports','require',Buffer.from(result.outputFiles[0].contents).toString('utf8'))(output,output.exports,require);const api=output.exports;
 const legacy={model:'cabin',icon:'HQ',color:'#c4973b'},known={catalog:'writer-map-symbols/1',name:'Castle'};
 assert.deepEqual(api.validatePlaceStyle(legacy),legacy);assert(!Object.hasOwn(api.validatePlaceStyle({color:'#c4973b'}),'catalogIcon'));assert.deepEqual(api.validatePlaceStyle({catalogIcon:null}),{catalogIcon:null});
 const chosen=api.validatePlaceStyle({...legacy,catalogIcon:known});assert.deepEqual(chosen,{...legacy,catalogIcon:known});assert.equal(api.hasPlaceModel(chosen),false);assert.equal(api.hasPlaceModel(legacy),true);
 for(const descriptor of [{catalog:'writer-map-symbols/2',name:'Castle'},{catalog:'writer-map-symbols/1',name:'castle'},{catalog:'writer-map-symbols/1',name:'Wand2'},{...known,svg:'<svg/>'}])assert.throws(()=>api.validatePlaceStyle({catalogIcon:descriptor}),'New invalid/noncanonical descriptor was accepted');
 const pixels=style=>{const canvas=createCanvas(96,96),ctx=canvas.getContext('2d');ctx.translate(48,48);const before=JSON.stringify(style),drawn=api.drawPlaceBuilding(ctx,style,undefined,8,'town');assert.equal(JSON.stringify(style),before,'Renderer rewrote imported RAW');return{drawn,pixels:Buffer.from(ctx.getImageData(0,0,96,96).data)};};
 const expected=pixels(legacy);
 for(const descriptor of [{catalog:'writer-map-symbols/future',name:'Castle'},{catalog:'writer-map-symbols/1',name:'UnknownFutureSymbol'},{catalog:'writer-map-symbols/1',name:'castle'}]){
  const imported={...legacy,catalogIcon:descriptor};assert.equal(api.hasPlaceModel(imported),true,'Unknown imported descriptor suppressed saved mesh');const actual=pixels(imported);assert.equal(actual.drawn,expected.drawn);assert(actual.pixels.equals(expected.pixels),'Unknown imported descriptor changed legacy fallback pixels');
 }
 const symbol=pixels({catalogIcon:known,color:'#c4973b'}),text=pixels({icon:'Castle',color:'#c4973b'});assert(symbol.drawn&&symbol.pixels.some((value,index)=>index%4===3&&value),'Known descriptor did not draw real pixels');assert(!symbol.pixels.equals(text.pixels),'New graphic was rendered as legacy Castle text');
 console.log('PASS Actual style validator and real Canvas preserve sparse/null/unknown-imported RAW and mesh fallback, reject new unknown/case/alias/extra writes, and draw a graphic distinct from legacy text');
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
