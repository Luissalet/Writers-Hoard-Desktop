//! Writers' local, session-oriented document transport. All document capabilities
//! live here and in the owned core crates; the build script only packages them.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::{Value, json};
use writer_doc::{Document, StoryRef, archive};
use writer_engine::{Selection, Session};

const ACTIONS: &[&str] = &[
    "commands",
    "document.new",
    "document.open",
    "document.openBytes",
    "document.save",
    "document.importHtml",
    "document.exportHtml",
    "document.exportBytes",
    "document.inspect",
    "document.text",
    "document.renderPage",
    "document.exportPdf",
    "document.close",
    "execute",
    "batch",
];

#[derive(Deserialize)]
struct Request {
    id: Value,
    action: String,
    #[serde(default = "empty_object")]
    args: Value,
}

fn empty_object() -> Value {
    json!({})
}

pub struct DocumentEngine {
    sessions: HashMap<String, Session>,
    next_session: u64,
    instance: String,
}

impl Default for DocumentEngine {
    fn default() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static GENERATION: AtomicU64 = AtomicU64::new(0);
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
        Self {
            sessions: HashMap::new(),
            next_session: 0,
            instance: format!("{}-{now:x}-{}", std::process::id(), GENERATION.fetch_add(1, Ordering::Relaxed)),
        }
    }
}

type ResultValue = Result<Value, String>;

impl DocumentEngine {
    pub fn handle_line(&mut self, line: &str) -> Value {
        let value: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(error) => return json!({"id": null, "ok": false, "error": {"code": "invalid_json", "message": error.to_string()}}),
        };
        let id = value.get("id").cloned().unwrap_or(Value::Null);
        let request = match serde_json::from_value::<Request>(value) {
            Ok(request) if request.args.is_object() => request,
            Ok(_) => return error_response(id, "invalid_request", "args must be an object"),
            Err(error) => return error_response(id, "invalid_request", &error.to_string()),
        };
        match self.dispatch(&request.action, &request.args) {
            Ok(result) => json!({"id": request.id, "ok": true, "result": result}),
            Err(message) => error_response(request.id, "document_error", &message),
        }
    }

    fn session(&mut self, args: &Value) -> Result<&mut Session, String> {
        let id = required(args, "sessionId")?;
        self.sessions.get_mut(id).ok_or_else(|| format!("unknown document session: {id}"))
    }

    fn put_document(&mut self, args: &Value, doc: Document, dirty: bool) -> ResultValue {
        let id = if let Some(id) = args.get("sessionId").and_then(Value::as_str) {
            if !self.sessions.contains_key(id) {
                return Err(format!("unknown document session: {id}"));
            }
            id.to_string()
        } else {
            self.next_session += 1;
            format!("writer-document-{}-{}", self.instance, self.next_session)
        };
        if let Some(session) = self.sessions.get_mut(&id) {
            session.close_typing();
            session.checkpoint("Import document");
            session.doc = doc;
            session.sel = Selection::caret(session.doc.start_of(StoryRef::Body));
            session.pending = None;
            session.path = None;
            session.password = None;
            session.touch();
            session.dirty = dirty;
            session.clamp_selection();
        } else {
            let mut session = Session::new(doc);
            session.dirty = dirty;
            self.sessions.insert(id.clone(), session);
        }
        let session = self.sessions.get_mut(&id).ok_or("session creation failed")?;
        Ok(session_result(&id, session))
    }

    pub fn dispatch(&mut self, action: &str, args: &Value) -> ResultValue {
        match action {
            "commands" => {
                let session = Session::new(Document::new());
                let query = args.get("query").and_then(Value::as_str).unwrap_or("").to_lowercase();
                let commands = session
                    .registry
                    .all()
                    .iter()
                    .filter(|spec| query.is_empty() || format!("{} {} {}", spec.id, spec.label, spec.location).to_lowercase().contains(&query))
                    .map(|spec| {
                        json!({
                            "id": spec.id, "label": spec.label, "location": spec.location,
                            "shortcut": spec.shortcut, "params": spec.params, "mutates": spec.mutates,
                            "atomicBatch": batch_safe(spec.id, &json!({})),
                        })
                    })
                    .collect::<Vec<_>>();
                Ok(
                    json!({"protocolVersion":1,"name":"Writers document engine","totalCommands":session.registry.all().len(),"commands":commands,"actions":ACTIONS,"positionUnit":"utf8Bytes"}),
                )
            }
            "document.new" => {
                let mut session = Session::new(Document::new());
                session
                    .run("file.new", &json!({"template":args.get("template").and_then(Value::as_str).unwrap_or("blank")}))
                    .map_err(|e| e.to_string())?;
                if let Some(text) = args.get("text").and_then(Value::as_str) {
                    session.doc = Document::from_text(text);
                }
                self.put_document(args, session.doc, false)
            }
            "document.open" | "document.openBytes" => {
                let (name, bytes) = if action == "document.open" {
                    let path = required(args, "path")?;
                    (path.to_string(), std::fs::read(path).map_err(|e| format!("{path}: {e}"))?)
                } else {
                    let format = required(args, "format")?;
                    let name = args.get("fileName").and_then(Value::as_str).map(str::to_owned).unwrap_or_else(|| format!("document.{format}"));
                    let bytes = STANDARD.decode(required(args, "dataBase64")?).map_err(|e| format!("invalid document base64: {e}"))?;
                    (format!("{name}.{format}"), bytes)
                };
                let password = args.get("password").and_then(Value::as_str);
                let (doc, encrypted) = writer_engine::io::open_bytes_with(&name, &bytes, password)?;
                let mut result = self.put_document(args, doc, false)?;
                let id = result["sessionId"].as_str().ok_or("session was not returned")?;
                if encrypted {
                    self.sessions.get_mut(id).ok_or("session disappeared")?.password = password.map(writer_engine::Password::new);
                }
                result["encrypted"] = json!(encrypted);
                Ok(result)
            }
            "document.importHtml" => {
                let html = required(args, "html")?;
                let assets = parse_assets(args.get("assets"))?;
                let mut doc = writer_formats::html::import_with(html, &|name| assets.get(name).cloned());
                doc.ensure_nonempty();
                self.put_document(args, doc, true)
            }
            "document.close" => {
                let id = required(args, "sessionId")?;
                let mut session = self.sessions.remove(id).ok_or_else(|| format!("unknown document session: {id}"))?;
                session.read_aloud.stop();
                Ok(json!({"sessionId":id,"closed":true}))
            }
            "document.inspect" => {
                let id = required(args, "sessionId")?.to_string();
                let session = self.session(args)?;
                let mut result = session_result(&id, session);
                result["document"] = serde_json::to_value(&session.doc).map_err(|e| e.to_string())?;
                result["assets"] = json!(archive::encode_assets(&session.doc.media));
                result["passthrough"] = json!(archive::encode_assets(&session.doc.passthrough));
                result["selection"] = serde_json::to_value(&session.sel).map_err(|e| e.to_string())?;
                result["undoDepth"] = json!(session.undo_depth());
                Ok(result)
            }
            "document.text" => Ok(json!({"text":self.session(args)?.doc.plain_text(StoryRef::Body)})),
            "document.exportHtml" => {
                let session = self.session(args)?;
                Ok(json!({"html":writer_formats::html::export(&session.doc),"assets":archive::encode_assets(&session.doc.media)}))
            }
            "document.exportBytes" => {
                let format = required(args, "format")?;
                let name = args.get("fileName").and_then(Value::as_str).map(str::to_owned).unwrap_or_else(|| format!("document.{format}"));
                let session = self.session(args)?;
                let password = output_password(args, session);
                let bytes = writer_engine::io::save_bytes_with(&format!("document.{format}"), &session.doc, password)?;
                Ok(
                    json!({"mimeType":mime_type(format),"dataBase64":STANDARD.encode(bytes),"fileName":name,"encrypted":password.is_some() && writer_engine::io::can_encrypt(&format!("document.{format}"))}),
                )
            }
            "document.save" => {
                let path = required(args, "path")?;
                let id = required(args, "sessionId")?.to_string();
                let session = self.session(args)?;
                let password = output_password(args, session);
                let bytes = writer_engine::io::save_bytes_with(path, &session.doc, password)?;
                let encrypted = password.is_some() && writer_engine::io::can_encrypt(path);
                writer_engine::io::write_bytes_atomic(Path::new(path), &bytes)?;
                if args.get("password").is_some() {
                    session.password = args.get("password").and_then(Value::as_str).filter(|s| !s.is_empty()).map(writer_engine::Password::new);
                }
                session.path = Some(Path::new(path).to_path_buf());
                session.dirty = false;
                let mut result = session_result(&id, session);
                result["path"] = json!(path);
                result["bytes"] = json!(bytes.len());
                result["encrypted"] = json!(encrypted);
                Ok(result)
            }
            "document.renderPage" => {
                let session = self.session(args)?;
                let page = args.get("page").and_then(Value::as_u64).unwrap_or(1);
                if page == 0 {
                    return Err("page is 1-based".into());
                }
                let scale = args.get("scale").and_then(Value::as_f64).unwrap_or(1.0) as f32;
                if !scale.is_finite() || scale <= 0.0 {
                    return Err("scale must be a positive finite number".into());
                }
                let layout = session.export_layout();
                let page = layout.pages.get((page - 1) as usize).ok_or("page does not exist")?;
                let image = writer_render::render_page(&session.doc, page, scale, &Default::default());
                let png = image.to_png();
                if png.is_empty() {
                    return Err("page could not be encoded as PNG".into());
                }
                Ok(json!({"mimeType":"image/png","dataBase64":STANDARD.encode(png),"width":image.width,"height":image.height}))
            }
            "document.exportPdf" => {
                let session = self.session(args)?;
                let bytes = writer_pdf::export(
                    &session.doc,
                    &writer_pdf::PdfOptions {
                        include_markup: args.get("includeMarkup").and_then(Value::as_bool).unwrap_or(false),
                        ..Default::default()
                    },
                )
                .map_err(|e| e.to_string())?;
                if let Some(path) = args.get("path").and_then(Value::as_str) {
                    writer_engine::io::write_bytes_atomic(Path::new(path), &bytes)?;
                }
                Ok(json!({"mimeType":"application/pdf","dataBase64":STANDARD.encode(bytes)}))
            }
            "execute" => {
                let id = required(args, "sessionId")?.to_string();
                let command = required(args, "command")?;
                let params = args.get("params").cloned().unwrap_or_else(empty_object);
                if !params.is_object() {
                    return Err("command params must be an object".into());
                }
                let session = self.session(args)?;
                let result = session.run(command, &params).map_err(|e| e.to_string())?;
                let mut reply = session_result(&id, session);
                reply["commandResult"] = result;
                reply["uiRequests"] = json!(std::mem::take(&mut session.ui_requests));
                Ok(reply)
            }
            "batch" => {
                let id = required(args, "sessionId")?.to_string();
                let commands = args.get("commands").and_then(Value::as_array).ok_or("commands must be an array")?;
                let mut candidate = self.session(args)?.clone();
                let mut results = Vec::new();
                for (index, item) in commands.iter().enumerate() {
                    let command = required(item, "command")?;
                    let params = item.get("params").cloned().unwrap_or_else(empty_object);
                    if !params.is_object() {
                        return Err(format!("batch command {index}: params must be an object"));
                    }
                    if !batch_safe(command, &params) {
                        return Err(format!(
                            "batch command {index} ({command}) has external effects; use execute or document export separately. The entire batch was rolled back."
                        ));
                    }
                    let result = candidate
                        .run(command, &params)
                        .map_err(|e| format!("batch command {index} ({command}): {e}; the entire batch was rolled back"))?;
                    results.push(json!({"command":command,"result":result}));
                }
                let mut reply = session_result(&id, &mut candidate);
                reply["results"] = json!(results);
                reply["atomic"] = json!(true);
                reply["uiRequests"] = json!(std::mem::take(&mut candidate.ui_requests));
                self.sessions.insert(id, candidate);
                Ok(reply)
            }
            _ => Err(format!("unknown document action: {action}")),
        }
    }
}

fn required<'a>(value: &'a Value, name: &str) -> Result<&'a str, String> {
    value.get(name).and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or_else(|| format!("{name} must be a non-empty string"))
}

fn output_password<'a>(args: &'a Value, session: &'a Session) -> Option<&'a str> {
    if let Some(value) = args.get("password") {
        value.as_str().filter(|s| !s.is_empty())
    } else {
        session.password.as_ref().map(writer_engine::Password::as_str)
    }
}

fn error_response(id: Value, code: &str, message: &str) -> Value {
    json!({"id":id,"ok":false,"error":{"code":code,"message":message}})
}

fn session_result(id: &str, session: &mut Session) -> Value {
    json!({"sessionId":id,"revision":session.rev(),"dirty":session.dirty,"summary":{
        "pages":session.layout().pages.len(),"words":session.word_count(),"paragraphs":session.doc.paragraph_count(),"assets":session.doc.media.len(),
    }})
}

fn parse_assets(value: Option<&Value>) -> Result<BTreeMap<String, std::sync::Arc<Vec<u8>>>, String> {
    let encoded: BTreeMap<String, String> = match value {
        Some(value) => serde_json::from_value(value.clone()).map_err(|e| format!("assets: {e}"))?,
        None => BTreeMap::new(),
    };
    archive::decode_assets(&encoded)
}

fn batch_safe(command: &str, params: &Value) -> bool {
    !matches!(
        command,
        "file.save"
            | "file.saveAs"
            | "file.exportPdf"
            | "file.exportPng"
            | "file.saveTemplate"
            | "tools.macros"
            | "edit.repeat"
            | "review.addToDictionary"
    ) && !command.starts_with("readAloud.")
        && command != "review.readAloud"
        && !(command == "mailings.finish" && params.get("path").is_some())
}

fn mime_type(format: &str) -> &'static str {
    match format {
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "odt" => "application/vnd.oasis.opendocument.text",
        "rtf" => "application/rtf",
        "html" => "text/html;charset=utf-8",
        "pdf" => "application/pdf",
        "json" | "writer.json" => "application/json",
        _ => "text/plain;charset=utf-8",
    }
}

#[cfg(test)]
mod tests;
