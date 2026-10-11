use std::sync::OnceLock;
use std::time::Instant;

use tauri::webview::PageLoadEvent;

static BOOT: OnceLock<Instant> = OnceLock::new();

pub fn start() {
    let _ = BOOT.get_or_init(Instant::now);
    mark("run");
}

pub fn mark(phase: &str) {
    let start = BOOT.get_or_init(Instant::now);
    eprintln!("boot {phase} ms={}", start.elapsed().as_millis());
}

pub fn on_page_load(event: PageLoadEvent) {
    let phase = match event {
        PageLoadEvent::Started => "page_started",
        PageLoadEvent::Finished => "page_finished",
    };
    mark(phase);
}
