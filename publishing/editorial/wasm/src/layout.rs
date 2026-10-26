use std::{collections::{BTreeMap, BTreeSet},sync::Arc};
use std::result::Result;
use gutenberg_compose::Cache;
use gutenberg_doc::{*,build::NewDocument,geom::{Rect,Affine,shapes}};
use crate::{input::*,validate};

fn image_item(asset:u64,width:f64,height:f64)->Item {
    let mut item=Item::new(ItemId(0),LayerId(0),Shape::Rectangle,shapes::rectangle(Rect::new(0.0,0.0,width,height)));
    item.fill=Fill::none();
    item.content=Content::Graphic(Graphic {asset:AssetId(asset),size:(width,height),xf:Affine::IDENTITY,auto_fit:Fitting::FitProportionally,fit_align:4,crop:[0.0;4]});
    item
}

fn story_blocks(blocks:&[Block],width:f64,next_table:&mut u64)->Result<Story,String> {
    let mut story=Story::new(StoryId(0));
    let mut pending_start=None;
    for block in blocks {
        if let Block::Paragraph{parts,para}=block
            && para.start_paragraph.is_some()
            && parts.iter().all(|p|matches!(p,Part::Text{text,..} if text.is_empty())) {
            pending_start=para.start_paragraph;
            continue;
        }
        if !story.is_empty()&&!story.text.ends_with('\n'){story.insert(story.len(),"\n");}
        match block {
            Block::Paragraph{parts,para}=>{
                let start=story.len();
                for part in parts {
                    match part {
                        Part::Text{text,style}=>{
                            if text.chars().any(|c|('\u{E000}'..='\u{E1FF}').contains(&c)){return Err("reserved-control-codepoint in manuscript".into());}
                            story.insert_with(story.len(),text,CharFormat {over:style.clone(),..Default::default()});
                        },
                        Part::Image{asset,width,height,block}=>{
                            if !width.is_finite()||!height.is_finite()||*width<=0.0||*height<=0.0{return Err("invalid image geometry".into());}
                            let position=if *block {AnchorPosition::AboveLine{align:anchored::AnchorAlign::Center,space_before:4.0,space_after:6.0}}else{AnchorPosition::Inline{y_offset:0.0}};
                            story.insert_object(story.len(),AnchoredObject::new(image_item(*asset,*width,*height),position));
                        }
                    }
                }
                let mut effective=para.clone();if let Some(start)=pending_start.take(){effective.start_paragraph=Some(start);}
                let end=story.len();story.format_paras(start..end,|p|p.para=effective.clone());
            },
            Block::Table{rows,columns,headers,cells,wide}=>{
                if *rows==0||*columns==0||*headers>=*rows{return Err("invalid table shape/header count".into());}
                let id=*next_table;*next_table+=1;
                let mut table=Table::new(id,rows-headers,*columns,*headers,0,width);
                let mut occupied=BTreeSet::new();
                for cell in cells {
                    let rs=cell.row_span as usize;let cs=cell.col_span as usize;
                    if rs==0||cs==0||cell.row.checked_add(rs).is_none_or(|n|n>*rows)||cell.column.checked_add(cs).is_none_or(|n|n>*columns){return Err("invalid table cell span".into());}
                    for r in cell.row..cell.row+rs{for c in cell.column..cell.column+cs{if !occupied.insert((r,c)){return Err("overlapping table cells".into());}}}
                    let content=story_blocks(&cell.blocks,width/(*columns as f64)*(cs as f64)-8.0,next_table)?;
                    let target=table.cell_mut(cell.row,cell.column).ok_or("missing table cell")?;
                    target.text=content;target.row_span=cell.row_span;target.col_span=cell.col_span;
                }
                let anchor=story.insert_table(story.len(),table);
                // The anchor owns its format; insertion must not inherit the preceding
                // paragraph's explicit page break, spanning width or keep options.
                story.format_paras(anchor..anchor+TABLE_ANCHOR.len_utf8(),|p|p.para=ParaAttrs::default());
                if let Some(start)=pending_start.take(){story.format_paras(anchor..anchor+TABLE_ANCHOR.len_utf8(),|p|p.para.start_paragraph=Some(start));}
                if *wide {story.format_paras(anchor..anchor+TABLE_ANCHOR.len_utf8(),|p|p.para.span_columns=Some(SpanColumns::Span(0)));}
            }
        }
    }
    story.check().map_err(|e|e.to_string())?;
    Ok(story)
}

fn frame(doc:&mut Document,page:usize,input:&Request,columns:u32)->Result<(ItemId,StoryId),String>{
    let (si,pi)=doc.page_loc(page).ok_or("missing page")?;
    let x=doc.spreads[si].pages[pi].x;
    let m=input.margins;
    let (left,right)=if page%2==0 {(m.inside,m.outside)}else{(m.outside,m.inside)};
    let layer=doc.layers.first().ok_or("missing layer")?.id;
    let (id,sid)=doc.add_text_frame(SpreadRef::Doc(si),Rect::new(x+left,m.top,x+input.width-right,input.height-m.bottom),layer,"",ParaFormat::default()).map_err(|e|e.to_string())?;
    let tf=doc.item_mut(id).and_then(Item::text_frame_mut).ok_or("missing text frame")?;
    tf.options.columns=columns;tf.options.gutter=7.0*72.0/25.4;
    Ok((id,sid))
}

fn colors(blocks:&[Block],out:&mut BTreeSet<String>){for b in blocks{match b{
    Block::Paragraph{parts,..}=>for p in parts{if let Part::Text{style,..}=p{if let Some(c)=&style.fill{out.insert(c.clone());}}},
    Block::Table{cells,..}=>for c in cells{colors(&c.blocks,out)},
}}}
fn asset_refs(blocks:&[Block],ids:&BTreeSet<u64>)->Result<(),String>{
    for block in blocks {match block {
        Block::Paragraph{parts,..}=>for part in parts{if let Part::Image{asset,..}=part{if !ids.contains(asset){return Err(format!("image asset {asset} is missing"));}}},
        Block::Table{cells,..}=>for cell in cells{asset_refs(&cell.blocks,ids)?;},
    }}
    Ok(())
}
fn rgb(s:&str)->Result<color::Color,String>{
    if s.len()!=7||!s.starts_with('#'){return Err(format!("unsupported color {s}"));}
    let n=u32::from_str_radix(&s[1..],16).map_err(|_|"invalid RGB color")?;
    Ok(color::Color::rgb(((n>>16)&255)as f32/255.0,((n>>8)&255)as f32/255.0,(n&255)as f32/255.0))
}

/// Add only pages that semantic composition needs. No parallel shaper or page cap.
pub fn compose(input:&Request,asset_bytes:&[u8],toc_pages:&BTreeMap<String,u32>)->Result<(Document,BTreeMap<String,u32>),String>{
    let m=input.margins;
    if ![input.width,input.height,m.top,m.bottom,m.inside,m.outside].iter().all(|v|v.is_finite()&&*v>=0.0)||input.width<=m.inside+m.outside||input.height<=m.top+m.bottom||input.initial_page_number==0{return Err("invalid physical page geometry".into());}
    let mut doc=Document::new(&NewDocument {title:input.title.clone(),width:input.width,height:input.height,pages:1,facing_pages:false,primary_text_frame:false,margins:m,..Default::default()});
    doc.created=input.created;doc.modified=input.created;
    let mut swatches=BTreeSet::from([input.paper.clone(),input.ink.clone()]);
    for s in &input.segments{colors(&s.blocks,&mut swatches)}
    for c in swatches{if c.starts_with('#'){doc.swatches.push(color::Swatch::color(&c,rgb(&c)?));}}
    let mut ids=BTreeSet::new();
    for a in &input.assets {
        let end=a.offset.checked_add(a.length).ok_or("asset range overflow")?;
        if a.id==0||!ids.insert(a.id)||a.length==0||end>asset_bytes.len()||a.width==0||a.height==0||!matches!(a.mime.as_str(),"image/png"|"image/jpeg"|"image/gif"|"image/webp"){return Err("invalid asset index/range/MIME".into());}
        let bytes=asset_bytes[a.offset..end].to_vec();
        let signature=match a.mime.as_str(){"image/png"=>bytes.starts_with(b"\x89PNG\r\n\x1a\n"),"image/jpeg"=>bytes.starts_with(&[255,216,255]),"image/gif"=>bytes.starts_with(b"GIF8"),"image/webp"=>bytes.starts_with(b"RIFF")&&bytes.get(8..12)==Some(b"WEBP"),_=>false};
        if !signature{return Err("asset MIME/signature mismatch".into());}
        doc.assets.insert(AssetId(a.id),Arc::new(Asset{id:AssetId(a.id),name:format!("publishing-{}",a.id),mime:a.mime.clone(),link:None,data:Arc::new(bytes),pixels:Some((a.width,a.height)),page:0}));
    }
    let mut first=true;let mut anchors=BTreeMap::new();let mut next_table=1;
    for segment in &input.segments {
        asset_refs(&segment.blocks,&ids)?;
        if segment.columns!=1&&segment.columns!=2{return Err("invalid column count".into());}
        if !first {doc.insert_pages(Some(doc.page_count()-1),1,None).map_err(|e|e.to_string())?;}first=false;
        let start_page=doc.page_count()-1;
        if !segment.cover {anchors.insert(segment.id.clone(),input.initial_page_number+start_page as u32-input.segments.first().is_some_and(|s|s.cover)as u32);}
        // Covers are page graphics, never a body line or an unnumbered fake paragraph.
        if segment.cover {
            let Some(Block::Paragraph{parts,..})=segment.blocks.first()else{return Err("cover image missing".into())};
            let Some(Part::Image{asset,..})=parts.first()else{return Err("cover image missing".into())};
            if !ids.contains(asset){return Err("cover asset missing".into());}
            let (si,pi)=doc.page_loc(start_page).ok_or("missing cover page")?;let x=doc.spreads[si].pages[pi].x;
            let a=input.assets.iter().find(|a|a.id==*asset).ok_or("cover asset missing")?;
            let scale=(input.width/a.width as f64).min(input.height/a.height as f64);
            let (w,h)=(a.width as f64*scale,a.height as f64*scale);
            let mut it=image_item(*asset,w,h);it.id=ItemId(doc.alloc());it.layer=doc.layers[0].id;it.xf=Affine::translate((x+(input.width-w)/2.0,(input.height-h)/2.0));
            doc.insert_item(SpreadRef::Doc(si),it,None).map_err(|e|e.to_string())?;
            continue;
        }
        let (mut last,sid)=frame(&mut doc,start_page,input,segment.columns)?;
        let width=(input.width-m.inside-m.outside-(segment.columns-1)as f64*7.0*72.0/25.4)/(segment.columns as f64);
        let mut blocks=segment.blocks.clone();
        for entry in &segment.toc {
            let number=toc_pages.get(&entry.id).map(u32::to_string).unwrap_or_else(||"…".into());
            let mut style=CharAttrs::default();style.fill=Some(input.ink.clone());
            blocks.push(Block::Paragraph {parts:vec![Part::Text{text:format!("{}    {}",entry.title,number),style}],para:ParaAttrs::default()});
        }
        let mut story=story_blocks(&blocks,width,&mut next_table)?;story.id=sid;story.frames.push(last);doc.stories.insert(sid,Arc::new(story));
        let mut previous=None;
        loop {
            // New Cache for changed frames/text; never reuse incomplete key invalidation.
            let cache=Cache::new();let composed=cache.get(&doc,sid,None);
            if composed.overset_at.is_none(){validate::validate(&composed)?;break;}
            let progress=validate::progress(&composed);
            if previous.as_ref()==Some(&progress){return Err(format!("layout-no-progress in {} (unplaceable paragraph/table group/object)",segment.id));}
            previous=Some(progress);
            let page=doc.page_count();doc.insert_pages(Some(page-1),1,None).map_err(|e|e.to_string())?;
            let (id,_)=frame(&mut doc,page,input,segment.columns)?;doc.thread(last,id).map_err(|e|e.to_string())?;last=id;
        }
    }
    if first{return Err("empty publishing document".into());}
    // Numbers are outside the body frame and cover never carries a number.
    let cover=input.segments.first().is_some_and(|s|s.cover);
    for page in 0..doc.page_count(){
        let (si,pi)=doc.page_loc(page).ok_or("missing page")?;let x=doc.spreads[si].pages[pi].x;
        let mut bg=Item::new(ItemId(doc.alloc()),doc.layers[0].id,Shape::Rectangle,shapes::rectangle(Rect::new(x,0.0,x+input.width,input.height)));
        bg.fill=Fill::swatch(&input.paper);doc.insert_item(SpreadRef::Doc(si),bg,Some(0)).map_err(|e|e.to_string())?;
        if page==0&&cover{continue;}
        let number=input.initial_page_number+(page as u32)-cover as u32;
        let y=input.height-m.bottom+4.0;
        if y+12.0>input.height {return Err("bottom margin leaves no room for page number".into());}
        let (_,sid)=doc.add_text_frame(SpreadRef::Doc(si),Rect::new(x+m.outside,y,x+input.width-m.inside,y+14.0),doc.layers[0].id,&number.to_string(),ParaFormat::default()).map_err(|e|e.to_string())?;
        let s=doc.story_mut(sid).ok_or("missing numbering story")?;let len=s.len();s.format_chars(0..len,|f|{f.over.size=Some(9.0);f.over.fill=Some(input.ink.clone());});s.format_paras(0..len,|p|p.para.align=Some(Align::Center));
    }
    doc.check().map_err(|e|e.to_string())?;
    Ok((doc,anchors))
}
