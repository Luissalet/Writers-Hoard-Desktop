//! Format crates registered with the I/O dispatcher.

use writer_doc::Document;

/// Open a format other than plain text / JSON.
pub fn open(ext: &str, bytes: &[u8]) -> Option<Result<Document, String>> {
    match ext {
        "docx" | "docm" | "dotx" | "dotm" => Some(writer_docx::read(bytes).map_err(|e| e.to_string())),
        "doc" | "dot" => Some(writer_docbin::read(bytes).map_err(|e| e.to_string())),
        other => writer_formats::import(other, bytes),
    }
}

/// Save to a format other than plain text / JSON.
pub fn save(ext: &str, doc: &Document) -> Option<Result<Vec<u8>, String>> {
    // .docx/.docm/.dotx/.dotm: the extension picks the package flavour Word expects.
    if let Some(flavor) = writer_docx::Flavor::from_ext(ext) {
        return Some(writer_docx::write_as(doc, flavor).map_err(|e| e.to_string()));
    }
    match ext {
        "png" => Some(render_png(doc, 0, 2.0)),
        "pdf" => Some(writer_pdf::export(doc, &Default::default()).map_err(|e| e.to_string())),
        other => writer_formats::export(other, doc),
    }
}

/// Render page `page` as PNG at `scale` px/pt.
pub fn render_png(doc: &Document, page: usize, scale: f32) -> Result<Vec<u8>, String> {
    let l = writer_layout::layout(doc, &mut writer_layout::LayoutCache::new(), &Default::default());
    let p = l.pages.get(page).ok_or_else(|| format!("no page {}", page + 1))?;
    let img = writer_render::render_page(doc, p, scale, &Default::default());
    Ok(img.to_png())
}
