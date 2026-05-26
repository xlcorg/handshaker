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
