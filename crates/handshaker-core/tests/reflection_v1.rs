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

#[tokio::test]
async fn v1_crawls_dependencies() {
    let (addr, _shutdown) = common::spawn_reflection_server_v1_with_deps().await;
    let channel = Endpoint::from_shared(format!("http://{}", addr))
        .unwrap()
        .connect()
        .await
        .unwrap();

    let (services, files) = list_and_fetch_files_v1(channel)
        .await
        .expect("v1 reflection with deps");

    assert!(
        services.iter().any(|s| s == "test.EchoWithDeps"),
        "expected `test.EchoWithDeps`, got {services:?}"
    );
    let file_names: Vec<String> = files
        .iter()
        .filter_map(|f| f.name.clone())
        .collect();
    assert!(
        file_names.iter().any(|n| n == "test/echo_with_deps.proto"),
        "expected echo_with_deps.proto, got {file_names:?}"
    );
    assert!(
        file_names.iter().any(|n| n == "test/common.proto"),
        "dep crawl failed — common.proto missing, got {file_names:?}"
    );
}
