use super::*;

fn import_html(engine: &mut DocumentEngine, html: &str) -> String {
    engine.dispatch("document.importHtml", &json!({"html":html})).unwrap()["sessionId"].as_str().unwrap().into()
}

fn reopen_docx(engine: &mut DocumentEngine, id: &str) -> (String, String) {
    use std::io::Read;
    let exported = engine.dispatch("document.exportBytes", &json!({"sessionId":id,"format":"docx"})).unwrap();
    let bytes = STANDARD.decode(exported["dataBase64"].as_str().unwrap()).unwrap();
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut xml = String::new();
    zip.by_name("word/document.xml").unwrap().read_to_string(&mut xml).unwrap();
    let reopened = engine.dispatch("document.openBytes", &json!({"format":"docx","dataBase64":exported["dataBase64"]})).unwrap()["sessionId"]
        .as_str()
        .unwrap()
        .into();
    (reopened, xml)
}

fn revision_span(id: &str, kind: &str, body: &str) -> String {
    format!(
        "<span data-wh-revision-id=\"{id}\" data-wh-revision-kind=\"{kind}\" data-wh-revision-author=\"Autora ñ\" data-wh-revision-source=\"faustus\" data-wh-revision-created-at=\"1791760353000\">{body}</span>"
    )
}

#[test]
fn writers_revision_docx_identity_author_date_unicode_and_decisions() {
    let mut engine = DocumentEngine::default();
    let html = format!(
        "<p><strong>{}{}</strong> {}</p>",
        revision_span("first", "deletion", "Antiguo ñ😀"),
        revision_span("first", "insertion", "Nuevo árbol😀"),
        revision_span("second", "insertion", "Otro")
    );
    let id = import_html(&mut engine, &html);
    let (reopened, xml) = reopen_docx(&mut engine, &id);
    assert!(xml.contains("<w:ins") && xml.contains("<w:del") && xml.contains("w:delText"));
    assert!(xml.contains("wh:revisionId=\"first\"") && xml.contains("wh:revisionId=\"second\""));
    assert!(xml.contains("wh:source=\"faustus\"") && xml.contains("w:author=\"Autora ñ\""));
    assert!(xml.contains("w:date=\"2026-10-11T23:12:33.000Z\""), "{xml}");
    assert!(xml.contains("xmlns:wh=\"urn:writers-hoard:document:1\"") && xml.contains("mc:Ignorable=\"w14 w15 wp14 wh\""));
    let inspected = engine.dispatch("document.inspect", &json!({"sessionId":reopened})).unwrap();
    assert_eq!(inspected["document"]["revisions"].as_array().unwrap().len(), 3);
    let review = engine.dispatch("document.exportHtml", &json!({"sessionId":reopened,"includeRevisions":true})).unwrap();
    assert!(review["html"].as_str().unwrap().contains("data-wh-revision-id=\"second\""));
    assert!(review["html"].as_str().unwrap().contains("Antiguo ñ😀"));
    let final_html = engine.dispatch("document.exportHtml", &json!({"sessionId":reopened})).unwrap();
    assert!(!final_html["html"].as_str().unwrap().contains("Antiguo"));
    assert!(!final_html["html"].as_str().unwrap().contains("data-wh-revision-"));
    engine.dispatch("execute", &json!({"sessionId":reopened,"command":"review.acceptAll"})).unwrap();
    assert_eq!(text(&mut engine, &reopened), "Nuevo árbol😀 Otro");
    engine.dispatch("execute", &json!({"sessionId":id,"command":"review.rejectAll"})).unwrap();
    assert_eq!(text(&mut engine, &id), "Antiguo ñ😀 ");
}

#[test]
fn tracked_paragraph_separators_images_and_notes_survive_docx_and_rejection() {
    let mut engine = DocumentEngine::default();
    let boundary = "data-wh-revision-break-id=\"split\" data-wh-revision-break-kind=\"insertion\" data-wh-revision-break-author=\"Luis\" data-wh-revision-break-source=\"editor\" data-wh-revision-break-created-at=\"123456\"";
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
    let html = format!(
        "<p>Antes{}</p><p {boundary}>{}</p>",
        revision_span(
            "removed",
            "deletion",
            &format!(
                "<img src=\"data:image/png;base64,{png}\" alt=\"Imagen\"><sup data-footnote-id=\"note-ñ\" data-footnote=\"Nota original\"></sup>"
            )
        ),
        revision_span("split", "insertion", "Añadido")
    );
    let id = import_html(&mut engine, &html);
    let (reopened, xml) = reopen_docx(&mut engine, &id);
    assert!(xml.contains("<w:rPr><w:ins") || xml.contains("<w:rPr><w:ins "));
    let review = engine.dispatch("document.exportHtml", &json!({"sessionId":reopened,"includeRevisions":true})).unwrap();
    let review = review["html"].as_str().unwrap();
    assert!(review.contains("data-wh-revision-break-id=\"split\""), "{review}");
    assert!(review.contains("data:image/png;base64") && review.contains("data-footnote-id=\"note-ñ\""), "{review}");
    let before = engine.sessions[&reopened].doc.media.clone();
    engine.dispatch("execute", &json!({"sessionId":reopened,"command":"review.rejectAll"})).unwrap();
    assert_eq!(engine.sessions[&reopened].doc.body.len(), 1);
    assert_eq!(engine.sessions[&reopened].doc.media, before);
    let html = engine.dispatch("document.exportHtml", &json!({"sessionId":reopened})).unwrap();
    assert!(html["html"].as_str().unwrap().contains("Nota original"));
}

#[test]
fn editorial_styles_sections_citations_and_literal_metadata_roundtrip() {
    let mut engine = DocumentEngine::default();
    let style = json!({"id":"lead","name":"Entradilla ñ","format":{"fontSize":18,"lineHeight":1.5,"color":"#123456"},"bold":true});
    let first = json!({"id":"first","start":"continuous","pageWidth":595.25,"pageHeight":841.75,"marginTop":60,"marginBottom":60,"marginLeft":55,"marginRight":55,"header":"Cabecera </script> & ñ","footer":"Pie"});
    let mut second = first.clone();
    second["id"] = json!("second");
    second["start"] = json!("nextPage");
    second["marginLeft"] = json!(90);
    let citation = json!({"id":"quote","sourceId":"source-1","label":"[1]","title":"Fuente </script> & ñ","evidenceId":"excerpt-1"});
    let metadata =
        |value: &Value| writer_formats::html::esc(&value.to_string().replace('<', "\\u003c").replace('>', "\\u003e").replace('&', "\\u0026"));
    let html = format!(
        "<div data-wh-editorial-style=\"{}\" hidden></div><div data-wh-section=\"{}\" hidden></div><p data-wh-style-id=\"lead\">Texto<span data-wh-citation=\"{}\">[1]</span></p><div data-wh-section=\"{}\" hidden></div><p data-wh-bibliography=\"source-1\">Fuente</p>",
        metadata(&style),
        metadata(&first),
        metadata(&citation),
        metadata(&second)
    );
    let id = import_html(&mut engine, &html);
    assert_eq!(engine.sessions[&id].doc.body.len(), 2);
    assert_eq!(engine.sessions[&id].doc.sections().len(), 2);
    assert_eq!(engine.sessions[&id].doc.last_section.margin_left, 90.0);
    let (reopened, xml) = reopen_docx(&mut engine, &id);
    assert!(xml.contains("wh:sectionId=\"first\"") && xml.contains("wh:sectionId=\"second\""));
    assert!(xml.contains("wh:citation") && xml.contains("wh:bibliography"));
    let exported = engine.dispatch("document.exportHtml", &json!({"sessionId":reopened})).unwrap();
    let html = exported["html"].as_str().unwrap();
    assert!(html.contains("data-wh-style-id=\"lead\"") && html.contains("Entradilla ñ"));
    assert!(html.contains("data-wh-bibliography=\"source-1\"") && html.contains("excerpt-1"));
    assert!(html.contains("\\u003c/script\\u003e") && !html.contains("Fuente &lt;/script&gt;"), "{html}");
    let imported_again = writer_formats::html::import(html);
    assert_eq!(imported_again.sections().len(), 2);
    assert_eq!(imported_again.last_section.margin_left, 90.0);
    assert_eq!(text(&mut engine, &reopened), "Texto[1]\nFuente");
    let pdf = engine.dispatch("document.exportPdf", &json!({"sessionId":reopened})).unwrap();
    assert!(STANDARD.decode(pdf["dataBase64"].as_str().unwrap()).unwrap().starts_with(b"%PDF-"));
}

#[test]
fn repeated_style_ids_are_local_to_chapters_and_materialized_overrides_win() {
    let mut engine = DocumentEngine::default();
    let style = |font: &str, size: u32| {
        writer_formats::html::esc(
            &json!({"id":"voice","name":font,"format":{"fontFamily":font,"fontSize":size},"bold":true,"headingLevel":3}).to_string(),
        )
    };
    let html = format!(
        "<h1 data-writing-id=\"one\" data-chapter-heading=\"\">One</h1><div data-wh-editorial-style=\"{}\" hidden></div><p data-wh-style-id=\"voice\"><span data-wh-size=\"18\" data-wh-font=\"Georgia\">Primero</span></p><h1 data-writing-id=\"two\" data-chapter-heading=\"\">Two</h1><div data-wh-editorial-style=\"{}\" hidden></div><p data-wh-style-id=\"voice\"><span data-wh-size=\"11\" data-wh-font=\"Arial\">Segundo</span></p>",
        style("Georgia", 18),
        style("Arial", 11)
    );
    let id = import_html(&mut engine, &html);
    let doc = &engine.sessions[&id].doc;
    assert_ne!(doc.body[1].as_para().unwrap().props.style, doc.body[3].as_para().unwrap().props.style);
    let (reopened, xml) = reopen_docx(&mut engine, &id);
    assert!(xml.contains("WritersEditorial-scope1-voice") && xml.contains("WritersEditorial-scope2-voice"));
    let exported = engine.dispatch("document.exportHtml", &json!({"sessionId":reopened})).unwrap();
    let html = exported["html"].as_str().unwrap();
    assert!(html.contains("data-writing-id=\"one\"") && html.contains("data-writing-id=\"two\""));
    let first = html.find("Primero").unwrap();
    let second = html.find("Segundo").unwrap();
    assert!(html[..first].contains("Georgia") && html[first..second].contains("Arial"));
    assert!(!html.contains("<strong>Primero") && !html.contains("<strong>Segundo"), "{html}");
    let back = writer_formats::html::import(html);
    assert_eq!(back.body.len(), 4);
    let one = back.body[1].as_para().unwrap();
    let two = back.body[3].as_para().unwrap();
    assert_eq!(one.props.outline_level, None);
    assert_eq!(two.props.outline_level, None);
    assert_ne!(one.props.style, two.props.style);
    assert_eq!(one.runs[0].props.size, Some(18.0));
    assert_eq!(two.runs[0].props.size, Some(11.0));
    assert_ne!(one.runs[0].props.bold, Some(true));
}

#[test]
fn final_projection_joins_deleted_separator_without_changing_session() {
    let mut engine = DocumentEngine::default();
    let html = "<p>Primero</p><p data-wh-revision-break-id=\"join\" data-wh-revision-break-kind=\"deletion\" data-wh-revision-break-author=\"Luis\" data-wh-revision-break-source=\"editor\" data-wh-revision-break-created-at=\"123\">Segundo</p>";
    let id = import_html(&mut engine, html);
    let before = engine.dispatch("document.inspect", &json!({"sessionId":id})).unwrap();
    let exported = engine.dispatch("document.exportHtml", &json!({"sessionId":id})).unwrap();
    let final_doc = writer_formats::html::import(exported["html"].as_str().unwrap());
    assert_eq!(final_doc.body.len(), 1);
    assert_eq!(final_doc.plain_text(StoryRef::Body), "PrimeroSegundo");
    let _ = engine.dispatch("document.renderPage", &json!({"sessionId":id,"page":1})).unwrap();
    let _ = engine.dispatch("document.exportPdf", &json!({"sessionId":id})).unwrap();
    let after = engine.dispatch("document.inspect", &json!({"sessionId":id})).unwrap();
    assert_eq!(before, after);
}

#[test]
fn foreign_word_revision_ids_with_same_author_date_do_not_collapse() {
    use std::io::Write;
    let mut archive = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let parts = [
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#,
        ),
        (
            "word/document.xml",
            r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:ins w:id="10" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>One</w:t></w:r></w:ins><w:ins w:id="11" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Two</w:t></w:r></w:ins></w:p></w:body></w:document>"#,
        ),
    ];
    for (name, contents) in parts {
        archive.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
        archive.write_all(contents.as_bytes()).unwrap();
    }
    let bytes = archive.finish().unwrap().into_inner();
    let mut engine = DocumentEngine::default();
    let imported = engine.dispatch("document.openBytes", &json!({"format":"docx","dataBase64":STANDARD.encode(bytes)})).unwrap();
    let id = imported["sessionId"].as_str().unwrap();
    assert_eq!(engine.sessions[id].doc.revisions.len(), 2);
}

fn new(engine: &mut DocumentEngine, text: &str) -> String {
    engine.dispatch("document.new", &json!({"text":text})).unwrap()["sessionId"].as_str().unwrap().into()
}

fn text(engine: &mut DocumentEngine, id: &str) -> String {
    engine.dispatch("document.text", &json!({"sessionId":id})).unwrap()["text"].as_str().unwrap().into()
}

#[test]
fn json_lines_preserve_ids_unicode_and_independent_sessions() {
    let mut engine = DocumentEngine::default();
    let response = engine.handle_line(r#"{"id":"español-😀","action":"document.new","args":{"text":"¡España! á 👩‍👩‍👧‍👦"}}"#);
    assert_eq!(response["id"], "español-😀");
    assert_eq!(response["ok"], true);
    let id = response["result"]["sessionId"].as_str().unwrap();
    assert_eq!(text(&mut engine, id).trim(), "¡España! á 👩‍👩‍👧‍👦");
    let second = new(&mut engine, "Segundo documento");
    engine.dispatch("execute", &json!({"sessionId":id,"command":"text.insert","params":{"text":"¿"}})).unwrap();
    assert_eq!(text(&mut engine, &second).trim(), "Segundo documento");
    assert_eq!(engine.handle_line("broken")["error"]["code"], "invalid_json");
    assert_eq!(engine.handle_line(r#"{"id":9,"action":"commands","args":false}"#)["id"], 9);
    assert_eq!(engine.handle_line(r#"{"id":9,"action":"commands","args":false}"#)["ok"], false);
}

#[test]
fn failed_batch_restores_document_selection_redo_and_undo() {
    let mut engine = DocumentEngine::default();
    let id = new(&mut engine, "Original");
    engine.dispatch("execute", &json!({"sessionId":id,"command":"text.insert","params":{"text":"Uno "}})).unwrap();
    let before = engine.dispatch("document.inspect", &json!({"sessionId":id})).unwrap();
    let error = engine
        .dispatch(
            "batch",
            &json!({"sessionId":id,"commands":[
                {"command":"edit.undo"},
                {"command":"select.all"},
                {"command":"text.insert","params":{"text":"Cambio"}},
                {"command":"this.command.does.not.exist"}
            ]}),
        )
        .unwrap_err();
    assert!(error.contains("rolled back"));
    let after = engine.dispatch("document.inspect", &json!({"sessionId":id})).unwrap();
    assert_eq!(before, after);
    engine.dispatch("execute", &json!({"sessionId":id,"command":"edit.undo"})).unwrap();
    assert_eq!(text(&mut engine, &id).trim(), "Original");
    engine.dispatch("execute", &json!({"sessionId":id,"command":"edit.redo"})).unwrap();
    assert_eq!(text(&mut engine, &id).trim(), "Uno Original");
}

#[test]
fn batch_commits_edits_and_reports_external_operations_without_side_effects() {
    let mut engine = DocumentEngine::default();
    let id = new(&mut engine, "");
    let response = engine
        .dispatch(
            "batch",
            &json!({"sessionId":id,"commands":[
                {"command":"text.insert","params":{"text":"Primero"}},
                {"command":"text.newParagraph"},
                {"command":"text.insert","params":{"text":"Segundo"}}
            ]}),
        )
        .unwrap();
    assert_eq!(response["atomic"], true);
    assert_eq!(response["results"].as_array().unwrap().len(), 3);
    assert_eq!(text(&mut engine, &id).trim(), "Primero\nSegundo");
    let before = text(&mut engine, &id);
    assert!(
        engine
            .dispatch(
                "batch",
                &json!({"sessionId":id,"commands":[
                    {"command":"text.insert","params":{"text":"No conservar"}},
                    {"command":"file.save","params":{"path":"should-not-exist.writer.json"}}
                ]})
            )
            .is_err()
    );
    assert_eq!(text(&mut engine, &id), before);
    assert!(!Path::new("should-not-exist.writer.json").exists());
}

#[test]
fn complete_native_archive_preserves_images_original_parts_and_revisions() {
    let mut engine = DocumentEngine::default();
    let id = new(&mut engine, "Texto español 😀");
    let session = engine.sessions.get_mut(&id).unwrap();
    let image = image::RgbaImage::from_pixel(2, 2, image::Rgba([200, 40, 10, 255]));
    let mut buffer = std::io::Cursor::new(Vec::new());
    image.write_to(&mut buffer, image::ImageFormat::Png).unwrap();
    let image_bytes = buffer.into_inner();
    session.doc.add_media(image_bytes.clone(), "png");
    session.doc.passthrough.insert("customXml/item1.xml".into(), std::sync::Arc::new(b"<original/>".to_vec()));
    let embedded = std::sync::Arc::new(writer_doc::graphic::Embedded {
        xml: "<a:graphic><c:chart r:id=\"rIdChart\"/></a:graphic>".into(),
        refs: vec![writer_doc::graphic::EmbeddedRef {
            id: "rIdChart".into(),
            kind: "chart".into(),
            target: "word/charts/chart1.xml".into(),
            external: false,
        }],
    });
    let paragraph = writer_doc::Paragraph::with_text("", Default::default());
    let mut paragraph = paragraph;
    paragraph
        .insert_object(
            0,
            writer_doc::para::InlineObject::Graphic {
                w: 20.0,
                h: 20.0,
                alt: "Chart".into(),
                float: Default::default(),
                graphic: std::sync::Arc::new(writer_doc::graphic::Graphic { source: Some(embedded.clone()), ..Default::default() }),
            },
            &Default::default(),
        )
        .unwrap();
    paragraph
        .insert_object(
            paragraph.text.len(),
            writer_doc::para::InlineObject::Image {
                media: "image1.png".into(),
                w: 20.0,
                h: 20.0,
                alt: "OLE preview".into(),
                float: Default::default(),
                crop: [0.0; 4],
                ole: Some(embedded),
            },
            &Default::default(),
        )
        .unwrap();
    session.doc.body.push(writer_doc::para_block(paragraph));
    session.run("review.trackChanges", &json!({"value":true})).unwrap();
    session.run("text.insert", &json!({"text":"Revisado "})).unwrap();
    let snapshot = engine.dispatch("document.inspect", &json!({"sessionId":id})).unwrap();
    let archive = engine.dispatch("document.exportBytes", &json!({"sessionId":id,"format":"writer.json"})).unwrap();
    let reopened = engine.dispatch("document.openBytes", &json!({"format":"writer.json","dataBase64":archive["dataBase64"]})).unwrap();
    let new_id = reopened["sessionId"].as_str().unwrap();
    let restored = engine.dispatch("document.inspect", &json!({"sessionId":new_id})).unwrap();
    for key in ["document", "assets", "passthrough"] {
        assert_eq!(snapshot[key], restored[key]);
    }
    assert_eq!(STANDARD.decode(restored["assets"]["image1.png"].as_str().unwrap()).unwrap(), image_bytes);
}

#[test]
fn html_image_docx_roundtrip_and_real_pdf_and_png_exports() {
    let mut engine = DocumentEngine::default();
    let image = image::RgbaImage::from_pixel(3, 3, image::Rgba([0, 120, 200, 255]));
    let mut buffer = std::io::Cursor::new(Vec::new());
    image.write_to(&mut buffer, image::ImageFormat::Png).unwrap();
    let image_bytes = buffer.into_inner();
    let html = format!(
        "<h1>España 😀</h1><p><b>Texto con énfasis</b></p><img src=\"data:image/png;base64,{}\" width=\"20\" height=\"20\">",
        STANDARD.encode(&image_bytes)
    );
    let id = engine.dispatch("document.importHtml", &json!({"html":html})).unwrap()["sessionId"].as_str().unwrap().to_owned();
    assert_eq!(engine.dispatch("document.inspect", &json!({"sessionId":id})).unwrap()["summary"]["assets"], 1);
    let exported = engine.dispatch("document.exportBytes", &json!({"sessionId":id,"format":"docx"})).unwrap();
    let restored_id = engine
        .dispatch("document.openBytes", &json!({"format":"docx","fileName":"España.docx","dataBase64":exported["dataBase64"]}))
        .unwrap()["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(text(&mut engine, &id), text(&mut engine, &restored_id));
    let restored_assets = engine.dispatch("document.inspect", &json!({"sessionId":restored_id})).unwrap()["assets"].clone();
    assert_eq!(restored_assets.as_object().unwrap().len(), 1);
    assert_eq!(STANDARD.decode(restored_assets.as_object().unwrap().values().next().unwrap().as_str().unwrap()).unwrap(), image_bytes);
    let pdf = engine.dispatch("document.exportPdf", &json!({"sessionId":restored_id})).unwrap();
    assert!(STANDARD.decode(pdf["dataBase64"].as_str().unwrap()).unwrap().starts_with(b"%PDF-"));
    let png = engine.dispatch("document.renderPage", &json!({"sessionId":restored_id,"page":1,"scale":0.5})).unwrap();
    let decoded = image::load_from_memory(&STANDARD.decode(png["dataBase64"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(decoded.width() as u64, png["width"].as_u64().unwrap());
    assert!(decoded.height() > 0);
    assert!(engine.dispatch("document.renderPage", &json!({"sessionId":restored_id,"page":0})).is_err());
}

#[test]
fn session_ids_never_alias_after_engine_restart() {
    let mut first = DocumentEngine::default();
    let old = new(&mut first, "Documento anterior");
    let mut restarted = DocumentEngine::default();
    let current = new(&mut restarted, "Documento actual");
    assert_ne!(old, current);
    assert!(restarted.dispatch("document.text", &json!({"sessionId":old})).is_err());
    restarted.dispatch("document.close", &json!({"sessionId":current})).unwrap();
    assert!(restarted.dispatch("document.text", &json!({"sessionId":current})).is_err());
}

#[test]
fn writers_notes_page_breaks_presets_indent_and_marks_round_trip_through_docx() {
    let mut engine = DocumentEngine::default();
    let html = "<p data-wh-indent=\"2\" data-wh-line-height=\"1.5\" data-wh-paragraph-style=\"lead\"><strong>España</strong><sup data-footnote-id=\"nota-ñ\" data-footnote=\"Cuerpo español &amp; &quot;citas&quot;\" class=\"wh-footnote-ref\"></sup></p><div data-wh-page-break=\"true\" style=\"break-after:page\"></div>\n<p style=\"margin-inline-start:1.5em\">Página dos <sub>2</sub></p>";
    let session = engine.dispatch("document.importHtml", &json!({"html":html})).unwrap();
    assert_eq!(session["summary"]["pages"], 2);
    let id = session["sessionId"].as_str().unwrap();
    let doc = &engine.sessions[id].doc;
    let first = doc.para(StoryRef::Body, &writer_doc::Path::top(0)).unwrap();
    assert_eq!(first.props.indent_left, Some(36.0));
    assert_eq!(first.props.line_spacing, Some(writer_doc::props::LineSpacing::Multiple(1.5)));
    assert_eq!(first.props.style.as_deref(), Some("WritersLead"));
    assert!(first.runs.iter().any(|run| run.props.bold == Some(true)));
    assert_eq!(doc.parts.values().filter(|part| part.kind == writer_doc::PartKind::Footnote).count(), 1);
    assert!(doc.parts.iter().any(|(id, _)| doc.plain_text(StoryRef::Part(*id)).contains("Cuerpo español & \"citas\"")));
    let out = engine.dispatch("document.exportHtml", &json!({"sessionId":id})).unwrap();
    let out = out["html"].as_str().unwrap();
    assert!(out.contains("data-footnote-id=\"nota-ñ\""), "{out}");
    assert!(out.contains("data-footnote=\"Cuerpo español &amp; &quot;citas&quot;\""), "{out}");
    assert!(out.contains("data-wh-page-break=\"true\""), "{out}");
    assert!(out.contains("data-wh-paragraph-style=\"lead\""), "{out}");
    let html_roundtrip = engine.dispatch("document.importHtml", &json!({"html":out})).unwrap();
    assert_eq!(html_roundtrip["summary"]["pages"], 2);
    let bytes = engine.dispatch("document.exportBytes", &json!({"sessionId":id,"format":"docx"})).unwrap();
    let reopened = engine.dispatch("document.openBytes", &json!({"format":"docx","dataBase64":bytes["dataBase64"]})).unwrap();
    assert_eq!(reopened["summary"]["pages"], 2);
    let reopened = engine.dispatch("document.inspect", &json!({"sessionId":reopened["sessionId"]})).unwrap();
    assert!(reopened["document"]["parts"].as_object().unwrap().values().any(|part| part["kind"] == "footnote"));
    assert!(reopened.to_string().contains("Cuerpo español"));
}

#[test]
fn command_catalog_query_is_case_insensitive_and_never_changes_total_coverage() {
    let mut engine = DocumentEngine::default();
    let all = engine.dispatch("commands", &json!({})).unwrap();
    let filtered = engine.dispatch("commands", &json!({"query":"BOLD"})).unwrap();
    assert_eq!(all["totalCommands"], filtered["totalCommands"]);
    assert!(all["commands"].as_array().unwrap().len() > 400);
    assert!(filtered["commands"].as_array().unwrap().iter().any(|spec| spec["id"] == "format.bold"));
    assert!(filtered["commands"].as_array().unwrap().len() < all["commands"].as_array().unwrap().len());
}

#[test]
fn encrypted_open_and_save_keep_the_session_password_until_explicitly_changed() {
    let mut engine = DocumentEngine::default();
    let id = new(&mut engine, "Documento secreto español");
    engine.dispatch("execute", &json!({"sessionId":id,"command":"file.encrypt","params":{"password":"primera-clave"}})).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("secreto.docx");
    std::fs::write(&target, b"previous complete file").unwrap();
    let saved = engine.dispatch("document.save", &json!({"sessionId":id,"path":target})).unwrap();
    assert_eq!(saved["encrypted"], true);
    let bytes = std::fs::read(&target).unwrap();
    assert!(!bytes.starts_with(b"PK"));
    assert!(writer_engine::io::open_bytes("secret.docx", &bytes).is_err());
    let reopened =
        engine.dispatch("document.openBytes", &json!({"format":"docx","dataBase64":STANDARD.encode(&bytes),"password":"primera-clave"})).unwrap();
    assert_eq!(reopened["encrypted"], true);
    let reopened = reopened["sessionId"].as_str().unwrap();
    let exported = engine.dispatch("document.exportBytes", &json!({"sessionId":reopened,"format":"docx"})).unwrap();
    assert_eq!(exported["encrypted"], true);
    assert!(writer_engine::io::open_bytes("secret.docx", &STANDARD.decode(exported["dataBase64"].as_str().unwrap()).unwrap()).is_err());
    engine.dispatch("document.save", &json!({"sessionId":reopened,"path":target,"password":"segunda-clave"})).unwrap();
    let bytes = std::fs::read(&target).unwrap();
    assert!(writer_engine::io::open_bytes_with("secret.docx", &bytes, Some("primera-clave")).is_err());
    assert!(writer_engine::io::open_bytes_with("secret.docx", &bytes, Some("segunda-clave")).is_ok());
    engine.dispatch("execute", &json!({"sessionId":reopened,"command":"file.encrypt","params":{"password":null}})).unwrap();
    engine.dispatch("document.save", &json!({"sessionId":reopened,"path":target})).unwrap();
    assert!(std::fs::read(&target).unwrap().starts_with(b"PK"));
    assert!(writer_engine::io::open_bytes("secret.docx", &std::fs::read(&target).unwrap()).is_ok());
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn table_column_widths_and_spans_survive_html_docx_and_native_round_trips() {
    let mut engine = DocumentEngine::default();
    for html in [
        "<table><tr><td data-wh-colwidth=\"170\">A</td><td colwidth=\"280\">B</td></tr></table>",
        "<table><tr><td style=\"width:170px\">A</td><td style=\"width:280px\">B</td></tr></table>",
        "<table><colgroup><col style=\"width:127.5pt\"><col style=\"width:210pt\"></colgroup><tr><td>A</td><td>B</td></tr></table>",
        "<table><tr><td colspan=\"2\" data-wh-colwidth=\"170,280\">A y B</td></tr></table>",
    ] {
        let id = engine.dispatch("document.importHtml", &json!({"html":html})).unwrap()["sessionId"].as_str().unwrap().to_owned();
        let grid = |engine: &DocumentEngine, id: &str| {
            engine.sessions[id]
                .doc
                .body
                .iter()
                .find_map(|block| match &**block {
                    writer_doc::Block::Table(table) => Some(table.grid.clone()),
                    _ => None,
                })
                .unwrap()
        };
        assert_eq!(grid(&engine, &id), vec![127.5, 210.0], "{html}");
        let exported = engine.dispatch("document.exportHtml", &json!({"sessionId":id})).unwrap();
        assert!(exported["html"].as_str().unwrap().contains("data-wh-colwidth"));
        let roundtrip = engine.dispatch("document.importHtml", &json!({"html":exported["html"]})).unwrap()["sessionId"].as_str().unwrap().to_owned();
        assert_eq!(grid(&engine, &roundtrip), vec![127.5, 210.0]);
        for format in ["docx", "writer.json"] {
            let exported = engine.dispatch("document.exportBytes", &json!({"sessionId":id,"format":format})).unwrap();
            let roundtrip =
                engine.dispatch("document.openBytes", &json!({"format":format,"dataBase64":exported["dataBase64"]})).unwrap()["sessionId"]
                    .as_str()
                    .unwrap()
                    .to_owned();
            assert_eq!(grid(&engine, &roundtrip), vec![127.5, 210.0], "{html} {format}");
        }
    }
}

#[test]
fn signed_list_starts_restarts_and_nested_labels_survive_docx_html_and_pdf() {
    use std::io::Read;
    use writer_doc::{Block, numbering::Counters};
    let html = "<ol start=\"0\"><li>Uno</li><li>Dos</li></ol><p>gap</p><ol start=\"-2\"><li>Tres</li><li>Cuatro</li></ol><p>gap</p><ol start=\"17\"><li>Padre<ol start=\"-2\"><li>Hijo</li><li>Otro</li></ol><ol start=\"0\"><li>Reinicio</li></ol></li><li>Siguiente</li></ol>";
    let labels = |engine: &DocumentEngine, id: &str| {
        let doc = &engine.sessions[id].doc;
        let mut counters = Counters::default();
        doc.body
            .iter()
            .filter_map(|block| match &**block {
                Block::Para(p) => p.props.numbering.and_then(|n| counters.next_label(&doc.numbering, n.num, n.level)).map(|(label, _)| label),
                _ => None,
            })
            .collect::<Vec<_>>()
    };
    let mut engine = DocumentEngine::default();
    let id = import_html(&mut engine, html);
    let expected = vec!["0.", "1.", "-2.", "-1.", "17.", "-2.", "-1.", "0.", "18."];
    assert_eq!(labels(&engine, &id), expected);
    let docx = engine.dispatch("document.exportBytes", &json!({"sessionId":id,"format":"docx"})).unwrap();
    let bytes = STANDARD.decode(docx["dataBase64"].as_str().unwrap()).unwrap();
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut xml = String::new();
    archive.by_name("word/numbering.xml").unwrap().read_to_string(&mut xml).unwrap();
    for start in ["0", "-2", "17"] {
        assert!(xml.contains(&format!("w:val=\"{start}\"")), "{xml}");
    }
    assert!(xml.contains("<w:startOverride w:val=\"0\""), "{xml}");
    let (reopened, _) = reopen_docx(&mut engine, &id);
    assert_eq!(labels(&engine, &reopened), expected);
    let exported = engine.dispatch("document.exportHtml", &json!({"sessionId":reopened})).unwrap();
    let exported = exported["html"].as_str().unwrap();
    for start in ["0", "-2", "17"] {
        assert!(exported.contains(&format!("<ol start=\"{start}\"")), "{exported}");
    }
    let again = import_html(&mut engine, exported);
    assert_eq!(labels(&engine, &again), expected, "{exported}");
    let pdf = engine.dispatch("document.exportPdf", &json!({"sessionId":again})).unwrap();
    assert!(STANDARD.decode(pdf["dataBase64"].as_str().unwrap()).unwrap().starts_with(b"%PDF"));
    let png = engine.dispatch("document.renderPage", &json!({"sessionId":again})).unwrap();
    assert!(STANDARD.decode(png["dataBase64"].as_str().unwrap()).unwrap().starts_with(b"\x89PNG"));
}

#[test]
fn section_note_part_remapping_preserves_note_identity_and_neighbor_formatting() {
    let mut engine = DocumentEngine::default();
    let section = writer_formats::html::esc(&json!({"id":"section","start":"continuous","pageWidth":595,"pageHeight":842,"marginTop":60,"marginBottom":60,"marginLeft":55,"marginRight":55,"header":"Header","footer":"Footer"}).to_string());
    let citation = writer_formats::html::esc(&json!({"id":"cite","sourceId":"src","label":"[1]"}).to_string());
    let id = import_html(
        &mut engine,
        &format!(
            "<div hidden data-wh-section=\"{section}\"></div><p><span data-wh-citation=\"{citation}\">[1]</span><sup data-footnote-id=\"note-ñ\" data-footnote=\"Nota española\"></sup></p>"
        ),
    );
    let (reopened, xml) = reopen_docx(&mut engine, &id);
    assert!(xml.contains("wh:noteId=\"note-ñ\""), "{xml}");
    let paragraph = engine.sessions[&reopened].doc.body[0].as_para().unwrap();
    let offset = paragraph
        .object_offsets()
        .into_iter()
        .find(|offset| matches!(paragraph.object_at(*offset), Some(writer_doc::InlineObject::NoteRef { .. })))
        .unwrap();
    let props = paragraph.run_ranges().find(|(range, _)| range.contains(&offset)).unwrap().1;
    assert!(props.writers_citation.is_none());
    let html = engine.dispatch("document.exportHtml", &json!({"sessionId":reopened,"includeRevisions":true})).unwrap();
    let html = html["html"].as_str().unwrap();
    assert!(html.contains("data-footnote-id=\"note-ñ\""), "{html}");
    assert!(html.contains("[1]</span><sup"), "{html}");
}
