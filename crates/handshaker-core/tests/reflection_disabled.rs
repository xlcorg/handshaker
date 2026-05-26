mod common;

use handshaker_core::CoreError;
use handshaker_core::grpc::reflection::list_and_fetch_files;
use tonic::transport::Endpoint;

#[tokio::test]
async fn bare_server_yields_reflection_disabled() {
    let (addr, _shutdown) = common::spawn_bare_server().await;
    let channel = Endpoint::from_shared(format!("http://{}", addr))
        .unwrap()
        .connect()
        .await
        .unwrap();

    let err = list_and_fetch_files(channel).await.unwrap_err();
    match err {
        CoreError::ReflectionDisabled { hint } => {
            assert!(
                hint.to_lowercase().contains("v1") && hint.to_lowercase().contains("v1alpha"),
                "hint should mention both protocols, got `{hint}`"
            );
        }
        other => panic!("expected ReflectionDisabled, got {other:?}"),
    }
}
