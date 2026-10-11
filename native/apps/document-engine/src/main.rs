#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use std::io::{BufRead, Write};

fn main() {
    let mut engine = writer_document_engine::DocumentEngine::default();
    let input = std::io::stdin();
    let mut output = std::io::stdout().lock();
    for line in input.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let response = engine.handle_line(&line);
        if serde_json::to_writer(&mut output, &response).is_err() || output.write_all(b"\n").is_err() || output.flush().is_err() {
            break;
        }
    }
}
