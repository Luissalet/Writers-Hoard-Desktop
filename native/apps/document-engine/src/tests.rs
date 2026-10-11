use super::*;

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
