use std::io::{self, BufRead, Write};
fn main() {
    let mut core = tartarus_core::api::Core::default();
    let stdin = io::stdin();
    let mut out = io::BufWriter::new(io::stdout());
    for line in stdin.lock().lines() {
        let result = line
            .map_err(|e| e.to_string())
            .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
            .and_then(|v| core.handle(v));
        let value = match result {
            Ok(v) => v,
            Err(e) => serde_json::json!({"error":e}),
        };
        writeln!(out, "{}", value).unwrap();
        out.flush().unwrap();
    }
}
