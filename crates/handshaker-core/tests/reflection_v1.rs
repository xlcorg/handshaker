mod common;

use handshaker_core::grpc::reflection::list_and_fetch_files_v1;
use tonic::transport::Endpoint;

#[tokio::test]
async fn v1_returns_service_and_descriptor() {
    let (addr, _shutdown) = common::spawn_reflection_server_v1().await;
    let channel = Endpoint::from_shared(format!("http://{}", addr))
        .unwrap()
        .connect()
        .await
        .unwrap();

    let (services, files) = list_and_fetch_files_v1(channel).await.expect("v1 reflection");

    assert!(
        services.iter().any(|s| s == "test.Echo"),
        "expected `test.Echo` in services, got {services:?}"
    );
    assert!(
        files.iter().any(|f| f.name.as_deref() == Some("test/echo.proto")),
        "expected `test/echo.proto` in files, got {:?}",
        files.iter().map(|f| f.name.clone()).collect::<Vec<_>>()
    );
}
