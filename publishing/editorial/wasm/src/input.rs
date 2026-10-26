use gutenberg_doc::{CharAttrs, Margins, ParaAttrs};
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Request {
    pub title: String,
    pub author: Option<String>,
    pub created: i64,
    pub width: f64,
    pub height: f64,
    pub margins: Margins,
    pub initial_page_number: u32,
    pub paper: String,
    pub ink: String,
    pub segments: Vec<Segment>,
    pub assets: Vec<AssetInput>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Segment {
    pub id: String,
    pub columns: u32,
    pub blocks: Vec<Block>,
    #[serde(default)]
    pub cover: bool,
    #[serde(default)]
    pub toc: Vec<TocEntry>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct TocEntry { pub id: String, pub title: String }

#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase", tag="kind", deny_unknown_fields)]
pub enum Block {
    Paragraph { parts: Vec<Part>, #[serde(default)] para: ParaAttrs },
    Table { rows: usize, columns: usize, headers: usize, cells: Vec<CellInput>, #[serde(default)] wide: bool },
}

#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase", tag="kind", deny_unknown_fields)]
pub enum Part {
    Text { text: String, #[serde(default)] style: CharAttrs },
    Image { asset: u64, width: f64, height: f64, #[serde(default)] block: bool },
}

#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct CellInput {
    pub row: usize, pub column: usize, pub row_span: u32, pub col_span: u32,
    pub blocks: Vec<Block>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct AssetInput {
    pub id: u64, pub offset: usize, pub length: usize, pub mime: String,
    pub width: u32, pub height: u32,
}
