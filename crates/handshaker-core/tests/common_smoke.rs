mod common;

#[test]
fn fixture_descriptor_set_is_nonempty() {
    let bytes = common::fixture_descriptor_set_bytes();
    assert!(!bytes.is_empty());
    assert!(bytes.len() < 4096, "fixture should be tiny, got {} bytes", bytes.len());
}

#[tokio::test]
async fn v1_server_spawns_and_listens() {
    let (addr, shutdown) = common::spawn_reflection_server_v1().await;
    assert_eq!(addr.ip().to_string(), "127.0.0.1");
    assert_ne!(addr.port(), 0);
    drop(shutdown);
}

#[tokio::test]
async fn v1alpha_server_spawns_and_listens() {
    let (addr, shutdown) = common::spawn_reflection_server_v1alpha().await;
    assert_eq!(addr.ip().to_string(), "127.0.0.1");
    assert_ne!(addr.port(), 0);
    drop(shutdown);
}

#[tokio::test]
async fn bare_server_spawns_and_listens() {
    let (addr, shutdown) = common::spawn_bare_server().await;
    // can we open a TCP connection? if so, the listener bound.
    let stream = tokio::net::TcpStream::connect(addr).await;
    assert!(stream.is_ok(), "bare server should accept TCP connections");
    drop(shutdown);
}

#[tokio::test]
async fn spawn_echo_server_binds_and_shuts_down() {
    let (addr, stop) = common::spawn_echo_server(common::EchoConfig::default()).await;
    assert!(addr.port() > 0);
    drop(stop);
    // Drop signals the shutdown receiver; the spawned task completes in background.
}
