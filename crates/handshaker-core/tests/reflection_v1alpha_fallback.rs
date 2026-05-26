mod common;

use handshaker_core::grpc::reflection::list_and_fetch_files;
use tonic::transport::Endpoint;

#[tokio::test]
async fn fallback_uses_v1alpha_when_v1_unimplemented() {
    let (addr, _shutdown) = common::spawn_reflection_server_v1alpha().await;
    let channel = Endpoint::from_shared(format!("http://{}", addr))
        .unwrap()
        .connect()
        .await
        .unwrap();

    let (services, files) = list_and_fetch_files(channel).await.expect("fallback");

    assert!(services.iter().any(|s| s == "test.Echo"));
    assert!(files.iter().any(|f| f.name.as_deref() == Some("test/echo.proto")));
}
