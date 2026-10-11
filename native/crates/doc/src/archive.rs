//! Writers' complete, versioned document archive. Images and retained source parts
//! are stored separately because the editing model deliberately omits binary data
//! from its ordinary JSON view.

use std::collections::BTreeMap;
use std::sync::Arc;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

use crate::Document;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Archive {
    pub format: String,
    pub version: u32,
    pub document: Document,
    #[serde(default)]
    pub assets: BTreeMap<String, String>,
    #[serde(default)]
    pub passthrough: BTreeMap<String, String>,
}

impl Archive {
    pub fn new(document: &Document) -> Self {
        Self {
            format: "writers-document".into(),
            version: 1,
            document: document.clone(),
            assets: encode_assets(&document.media),
            passthrough: encode_assets(&document.passthrough),
        }
    }

    pub fn into_document(mut self) -> Result<Document, String> {
        if self.format != "writers-document" || self.version != 1 {
            return Err("unsupported Writers document archive format or version".into());
        }
        self.document.media = decode_assets(&self.assets)?;
        self.document.passthrough = decode_assets(&self.passthrough)?;
        self.document.ensure_nonempty();
        Ok(self.document)
    }
}

pub fn encode_assets(assets: &BTreeMap<String, Arc<Vec<u8>>>) -> BTreeMap<String, String> {
    assets.iter().map(|(name, bytes)| (name.clone(), STANDARD.encode(bytes.as_slice()))).collect()
}

pub fn decode_assets(assets: &BTreeMap<String, String>) -> Result<BTreeMap<String, Arc<Vec<u8>>>, String> {
    assets
        .iter()
        .map(|(name, data)| {
            STANDARD.decode(data).map(|bytes| (name.clone(), Arc::new(bytes))).map_err(|e| format!("{name}: invalid asset base64: {e}"))
        })
        .collect()
}

pub fn encode(document: &Document) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&Archive::new(document)).map_err(|e| e.to_string())
}

pub fn decode(bytes: &[u8]) -> Result<Document, String> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    if value.get("format").is_some() {
        serde_json::from_value::<Archive>(value).map_err(|e| e.to_string())?.into_document()
    } else {
        // Legacy text-only snapshots remain readable. Missing assets cannot be recovered.
        serde_json::from_value::<Document>(value).map_err(|e| e.to_string())
    }
}
