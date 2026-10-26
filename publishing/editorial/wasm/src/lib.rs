mod input;
mod layout;
mod validate;
use std::collections::{BTreeMap,BTreeSet};
use gutenberg_compose::Cache;
use gutenberg_pdf::{PdfOptions,export_pdf_with_report};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct PdfOutput { bytes:Vec<u8>,report:String }
#[wasm_bindgen]
impl PdfOutput {
    #[wasm_bindgen(getter)]pub fn bytes(&self)->Vec<u8>{self.bytes.clone()}
    #[wasm_bindgen(getter)]pub fn report(&self)->String{self.report.clone()}
}
#[wasm_bindgen]
pub fn render_pdf(request_json:&str,assets:&[u8])->Result<PdfOutput,JsValue>{render(request_json,assets).map_err(|e|JsValue::from_str(&e))}
fn render(request_json:&str,assets:&[u8])->Result<PdfOutput,String>{
    let input:input::Request=serde_json::from_str(request_json).map_err(|e|e.to_string())?;
    let mut pages=BTreeMap::new();let mut seen=BTreeSet::new();let mut passes=0;
    loop {
        let (doc,next)=layout::compose(&input,assets,&pages)?;passes+=1;
        if input.segments.iter().any(|s|!s.toc.is_empty())&&pages!=next{
            let state=serde_json::to_string(&next).map_err(|e|e.to_string())?;
            if !seen.insert(state){return Err("toc-layout-cycle".into());}pages=next;continue;
        }
        let cache=Cache::new();let mut families=BTreeSet::new();let mut glyphs=0;
        for sid in doc.stories.keys(){
            let cs=cache.get(&doc,*sid,None);validate::validate(&cs)?;
            for frame in &cs.frames{for line in &frame.lines{for g in &line.glyphs{if g.visible{families.insert(g.face.family.clone());glyphs+=1;}}}}
        }
        let out=export_pdf_with_report(&doc,&cache,&PdfOptions {title:Some(input.title.clone()),author:input.author.clone(),created:Some(input.created),..Default::default()}).map_err(|e|e.to_string())?;
        if !out.warnings.is_empty(){return Err(format!("pdf-export-warning: {:?}",out.warnings));}
        return Ok(PdfOutput{bytes:out.bytes,report:serde_json::json!({"pages":out.pages,"anchors":next,"passes":passes,"families":families,"visibleGlyphs":glyphs,"warnings":[],"widthPt":input.width,"heightPt":input.height,"engine":"Writer editorial core","textSelectable":true}).to_string()});
    }
}
