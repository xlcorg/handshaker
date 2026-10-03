//! Live-check server: the integration-test echo fixture on a fixed port, with reflection.
//!
//! ```text
//! cargo run -p handshaker-core --example echo_server -- [--port 50051] [--count 20]
//!     [--delay-ms 300] [--fail-after K:CODE] [--hang] [--status CODE]
//! ```
//!
//! Point Handshaker at `127.0.0.1:<port>` (TLS off). Service `test.Echo`:
//!
//! - `Send(Ping) → Pong` — unary (`--status CODE` makes it answer with that gRPC status)
//! - `ServerStream(Ping) → stream Pong` — `--count` rows, `--delay-ms` apart;
//!   `--fail-after K:CODE` ends with a non-OK status after K rows (K = 0: trailers-only)
//! - `ClientStream(stream Ping) → Pong { echoed: "count: N" }`; `--hang` never answers
//!   after half-close (phase-2 deadline)
//! - `Bidi(stream Ping) → stream Pong` — echoes each message
//! - `Download(Ping) → stream Chunk { name, data }` — a small PNG in chunks (Assemble)

#[path = "../tests/common/mod.rs"]
mod common;

use std::collections::HashMap;
use std::time::Duration;

/// A valid 1×1 PNG; `Download` streams it in `CHUNK` byte pieces.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0xF0,
    0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF, 0x56, 0xC7, 0x2F, 0x0D, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
];
const CHUNK: usize = 16;

fn usage() -> ! {
    eprintln!(
        "usage: echo_server [--port N] [--count N] [--delay-ms N] [--fail-after K:CODE] [--hang] [--status CODE]"
    );
    std::process::exit(2);
}

fn value<T: std::str::FromStr>(args: &mut impl Iterator<Item = String>) -> T {
    args.next().and_then(|v| v.parse().ok()).unwrap_or_else(|| usage())
}

#[tokio::main]
async fn main() {
    let mut port: u16 = 50051;
    let mut config = common::EchoConfig {
        stream_count: 20,
        stream_delay: Some(Duration::from_millis(300)),
        trailers: HashMap::from([("x-echo-server".to_string(), "live-check".to_string())]),
        download_name: "pixel.png".to_string(),
        download_chunks: PNG.chunks(CHUNK).map(<[u8]>::to_vec).collect(),
        ..Default::default()
    };

    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--port" => port = value(&mut args),
            "--count" => config.stream_count = value(&mut args),
            "--delay-ms" => {
                let ms: u64 = value(&mut args);
                config.stream_delay = (ms > 0).then(|| Duration::from_millis(ms));
            }
            "--fail-after" => {
                let spec: String = value(&mut args);
                let (k, code) = spec.split_once(':').unwrap_or_else(|| usage());
                config.fail_after = Some((
                    k.parse().unwrap_or_else(|_| usage()),
                    code.parse().unwrap_or_else(|_| usage()),
                ));
            }
            "--hang" => config.client_stream_hang = true,
            "--status" => config.return_status = Some(value(&mut args)),
            _ => usage(),
        }
    }

    println!(
        "ServerStream: {} rows, delay {:?}, fail_after {:?} · ClientStream hang: {} · Download: {} chunks of {:?}",
        config.stream_count,
        config.stream_delay,
        config.fail_after,
        config.client_stream_hang,
        config.download_chunks.len(),
        config.download_name,
    );
    let (addr, _shutdown) = common::spawn_echo_server_on(&format!("127.0.0.1:{port}"), config).await;
    println!("test.Echo listening on {addr} (plaintext, reflection v1) — Ctrl+C to stop");
    std::future::pending::<()>().await;
}
