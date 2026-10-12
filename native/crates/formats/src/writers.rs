//! Writers semantic HTML metadata and revision identity.
use crate::model::{FBlock, Flow, Inline};
use writer_doc::{Revision, RevisionKind};

fn attribute<'a>(attrs: &'a [(String, String)], name: &str) -> Option<&'a str> {
    attrs.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str())
}

pub(crate) fn revision(attrs: &[(String, String)], boundary: bool) -> Option<Revision> {
    let prefix = if boundary { "data-wh-revision-break-" } else { "data-wh-revision-" };
    let get = |key: &str| attribute(attrs, &format!("{prefix}{key}"));
    let kind = match get("kind")? {
        "insertion" => RevisionKind::Insert,
        "deletion" => RevisionKind::Delete,
        _ => return None,
    };
    let id = get("id")?.to_string();
    if id.is_empty() {
        return None;
    }
    let created_at = get("created-at")?.parse::<f64>().ok().filter(|v| v.is_finite() && *v >= 0.0)?;
    Some(Revision {
        kind,
        author: get("author")?.into(),
        date: iso_millis(created_at),
        own_id: Some(id),
        source: Some(get("source")?.into()),
        created_at: Some(created_at),
        ..Default::default()
    })
}

pub(crate) fn revision_attrs(revision: &Revision, boundary: bool) -> String {
    let prefix = if boundary { "data-wh-revision-break-" } else { "data-wh-revision-" };
    let kind = match revision.kind {
        RevisionKind::Insert => "insertion",
        RevisionKind::Delete => "deletion",
        _ => return String::new(),
    };
    let created_at = revision.created_at.unwrap_or_else(|| millis_from_iso(&revision.date).unwrap_or(0.0));
    let fields = [
        ("id", revision.own_id.clone().unwrap_or_default()),
        ("kind", kind.into()),
        ("author", revision.author.clone()),
        ("source", revision.source.clone().unwrap_or_else(|| "docx".into())),
        ("created-at", created_at.to_string()),
    ];
    fields.iter().map(|(key, value)| format!(" {prefix}{key}=\"{}\"", crate::html::esc(value))).collect()
}

pub(crate) fn native_revision(doc: &writer_doc::Document, index: u32) -> Option<Revision> {
    let mut revision = doc.revisions.get(index as usize)?.clone();
    if revision.own_id.is_none() {
        revision.own_id = Some(format!("native-{index}"));
    }
    Some(revision)
}

pub(crate) fn strip_flow_revisions(flow: &mut Flow) {
    fn blocks(items: &mut [FBlock]) {
        for block in items {
            match block {
                FBlock::Para(p) => {
                    p.break_revision = None;
                    for inline in &mut p.inlines {
                        match inline {
                            Inline::Text(_, f) => f.revision = None,
                            Inline::Image(image) => image.revision = None,
                            _ => {}
                        }
                    }
                }
                FBlock::Table(table) => {
                    for cell in table.rows.iter_mut().flatten() {
                        blocks(&mut cell.blocks);
                    }
                }
                FBlock::Section(_) | FBlock::StyleDefinition(_) => {}
            }
        }
    }
    blocks(&mut flow.blocks);
}

pub(crate) fn metadata_attribute(attrs: &[(String, String)], key: &str) -> Option<serde_json::Value> {
    let value: serde_json::Value = serde_json::from_str(attribute(attrs, key)?).ok()?;
    value.is_object().then_some(value)
}

/// JSON Unicode escapes keep literal markup recoverable through DOMPurify SAFE_FOR_XML.
pub(crate) fn serialized_metadata(value: &serde_json::Value) -> String {
    value.to_string().replace('<', "\\u003c").replace('>', "\\u003e").replace('&', "\\u0026")
}

pub(crate) fn import_styles(doc: &mut writer_doc::Document, values: &[serde_json::Value]) {
    // Writers styles are linked presets with materialized HTML formatting. A Word cascade
    // would resurrect formatting the author cleared while keeping the semantic style id.
    for value in values {
        let Some(id) = value.get("id").and_then(serde_json::Value::as_str).filter(|id| !id.is_empty()) else { continue };
        let Some(name) = value.get("name").and_then(serde_json::Value::as_str) else { continue };
        doc.styles.upsert(writer_doc::styles::Style {
            id: format!("WritersEditorial-{id}"),
            name: name.into(),
            based_on: Some("Normal".into()),
            quick: true,
            ..Default::default()
        });
    }
}

pub(crate) fn section_from_json(doc: &mut writer_doc::Document, value: &serde_json::Value) -> Option<writer_doc::SectionProps> {
    let id = value.get("id")?.as_str()?.to_string();
    if id.is_empty() {
        return None;
    }
    let number = |key: &str| value.get(key)?.as_f64().map(|v| v as f32).filter(|v| v.is_finite() && *v >= 0.0);
    let mut section = writer_doc::SectionProps {
        writers_section_id: Some(id),
        page_w: number("pageWidth")?,
        page_h: number("pageHeight")?,
        margin_top: number("marginTop")?,
        margin_right: number("marginRight")?,
        margin_bottom: number("marginBottom")?,
        margin_left: number("marginLeft")?,
        ..Default::default()
    };
    if section.page_w <= section.margin_left + section.margin_right || section.page_h <= section.margin_top + section.margin_bottom {
        return None;
    }
    section.start = match value.get("start")?.as_str()? {
        "continuous" => writer_doc::section::SectionStart::Continuous,
        "nextPage" => writer_doc::section::SectionStart::NextPage,
        "evenPage" => writer_doc::section::SectionStart::EvenPage,
        "oddPage" => writer_doc::section::SectionStart::OddPage,
        _ => return None,
    };
    for (key, footer) in [("header", false), ("footer", true)] {
        let text = value.get(key)?.as_str()?;
        if !text.is_empty() {
            let mut paragraph = writer_doc::Paragraph::new();
            let _ = paragraph.insert_text(0, text, &Default::default());
            let id = doc
                .add_part(if footer { writer_doc::PartKind::Footer } else { writer_doc::PartKind::Header }, vec![writer_doc::para_block(paragraph)]);
            if footer {
                section.footers.default = Some(id);
            } else {
                section.headers.default = Some(id);
            }
        }
    }
    Some(section)
}

pub(crate) fn section_json(doc: &writer_doc::Document, section: &writer_doc::SectionProps) -> serde_json::Value {
    let text = |id: Option<u32>| id.map(|id| doc.plain_text(writer_doc::StoryRef::Part(id))).unwrap_or_default();
    serde_json::json!({"id":section.writers_section_id,"start":section.start,"pageWidth":section.page_w,"pageHeight":section.page_h,"marginTop":section.margin_top,"marginRight":section.margin_right,"marginBottom":section.margin_bottom,"marginLeft":section.margin_left,"header":text(section.headers.default),"footer":text(section.footers.default)})
}

/// Gregorian civil date calculation already used by the Writers command engine.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn iso_millis(ms: f64) -> String {
    if !ms.is_finite() || ms < 0.0 || ms / 1000.0 > u64::MAX as f64 {
        return String::new();
    }
    let (year, month, day) = civil_from_days((ms / 86_400_000.0) as i64);
    let seconds = ((ms / 1000.0) % 86_400.0) as u32;
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z", seconds / 3600, seconds / 60 % 60, seconds % 60, (ms % 1000.0) as u32)
}

fn millis_from_iso(value: &str) -> Option<f64> {
    let (date, time) = value.split_once('T')?;
    let mut date = date.split('-');
    let mut year = date.next()?.parse::<i64>().ok()?;
    let month = date.next()?.parse::<i64>().ok()?;
    let day = date.next()?.parse::<i64>().ok()?;
    let time = time.strip_suffix('Z').or_else(|| time.strip_suffix("+00:00"))?;
    let mut time = time.split(':');
    let hour = time.next()?.parse::<f64>().ok()?;
    let minute = time.next()?.parse::<f64>().ok()?;
    let second = time.next()?.parse::<f64>().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || !(0..=(i64::MAX / 366)).contains(&year) {
        return None;
    }
    year -= i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    let milliseconds = days as f64 * 86_400_000.0 + hour * 3_600_000.0 + minute * 60_000.0 + second * 1000.0;
    (milliseconds.is_finite() && milliseconds >= 0.0).then_some(milliseconds)
}

/// Features the Writers manuscript HTML schema cannot express, preserved in the native file.
pub fn revision_warnings(doc: &writer_doc::Document) -> Vec<&'static str> {
    let mut warnings = Vec::new();
    if doc.revisions.iter().any(|revision| revision.kind == RevisionKind::Format) {
        warnings.push("tracked-formatting-not-in-manuscript-html");
    }
    if doc.revisions.iter().any(|revision| revision.move_name.is_some()) {
        warnings.push("move-linkage-not-in-manuscript-html");
    }
    if doc.revisions.iter().any(|revision| revision.created_at.is_none() && !revision.date.is_empty() && millis_from_iso(&revision.date).is_none()) {
        warnings.push("revision-date-not-representable-as-manuscript-timestamp");
    }
    if doc.para_paths(writer_doc::StoryRef::Body).iter().filter_map(|path| doc.para(writer_doc::StoryRef::Body, path)).any(|paragraph| {
        (paragraph.mark.ins.is_some() && paragraph.mark.del.is_some())
            || paragraph.runs.iter().any(|run| run.props.ins.is_some() && run.props.del.is_some())
    }) {
        warnings.push("nested-insertion-and-deletion-not-in-manuscript-html");
    }
    if doc.body.last().and_then(|block| block.as_para()).is_some_and(|paragraph| paragraph.mark.ins.is_some() || paragraph.mark.del.is_some()) {
        warnings.push("trailing-paragraph-revision-has-no-following-manuscript-paragraph");
    }
    warnings
}
