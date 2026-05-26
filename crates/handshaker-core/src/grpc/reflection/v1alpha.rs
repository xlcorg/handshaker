//! v1alpha adapter: structural twin of `V1Adapter`, talks to v1alpha generated client.

use crate::error::CoreError;
use crate::grpc::reflection::algorithm::{self, ReflectionAdapter, SessionOutcome, SessionPlan};
use crate::grpc::transport::TonicChannel;
use async_trait::async_trait;
use prost_types::FileDescriptorProto;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tonic::Code;
use tonic_reflection::pb::v1alpha::server_reflection_client::ServerReflectionClient;
use tonic_reflection::pb::v1alpha::server_reflection_request::MessageRequest;
use tonic_reflection::pb::v1alpha::server_reflection_response::MessageResponse;
use tonic_reflection::pb::v1alpha::ServerReflectionRequest;

pub(crate) struct V1AlphaAdapter;

#[async_trait]
impl ReflectionAdapter for V1AlphaAdapter {
    fn version_label(&self) -> &'static str {
        "v1alpha"
    }

    async fn run_session(
        &self,
        channel: TonicChannel,
        plan: SessionPlan,
    ) -> Result<SessionOutcome, CoreError> {
        let mut client = ServerReflectionClient::new(channel);

        // Build the request stream. Use an unbounded channel so all sends complete
        // synchronously before we hand the receiver to tonic — a bounded channel
        // would deadlock when the batch exceeds the buffer capacity (no consumer
        // yet at send time).
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<ServerReflectionRequest>();
        if plan.list_services {
            tx.send(make_list_services_request())
                .map_err(|_| CoreError::Reflection("send list_services: channel closed".into()))?;
        }
        for sym in &plan.symbols {
            tx.send(make_file_containing_symbol_request(sym))
                .map_err(|_| CoreError::Reflection("send file_containing_symbol: channel closed".into()))?;
        }
        for fname in &plan.filenames {
            tx.send(make_file_by_filename_request(fname))
                .map_err(|_| CoreError::Reflection("send file_by_filename: channel closed".into()))?;
        }
        drop(tx);

        let response = client
            .server_reflection_info(UnboundedReceiverStream::new(rx))
            .await
            .map_err(map_status)?;
        let mut stream = response.into_inner();

        let mut services = Vec::new();
        let mut file_proto_bytes: Vec<Vec<u8>> = Vec::new();

        while let Some(item) = stream.message().await.map_err(map_status)? {
            let Some(msg) = item.message_response else {
                continue;
            };
            match msg {
                MessageResponse::ListServicesResponse(list) => {
                    for s in list.service {
                        services.push(s.name);
                    }
                }
                MessageResponse::FileDescriptorResponse(fdr) => {
                    file_proto_bytes.extend(fdr.file_descriptor_proto.into_iter().map(|b| b.to_vec()));
                }
                MessageResponse::ErrorResponse(e) => {
                    return Err(CoreError::Reflection(format!(
                        "v1alpha server error: code={} {}",
                        e.error_code, e.error_message
                    )));
                }
                MessageResponse::AllExtensionNumbersResponse(_) => {}
            }
        }

        Ok(SessionOutcome {
            services,
            file_proto_bytes,
        })
    }
}

fn make_list_services_request() -> ServerReflectionRequest {
    ServerReflectionRequest {
        host: String::new(),
        message_request: Some(MessageRequest::ListServices(String::new())),
    }
}

fn make_file_containing_symbol_request(symbol: &str) -> ServerReflectionRequest {
    ServerReflectionRequest {
        host: String::new(),
        message_request: Some(MessageRequest::FileContainingSymbol(symbol.to_string())),
    }
}

fn make_file_by_filename_request(filename: &str) -> ServerReflectionRequest {
    ServerReflectionRequest {
        host: String::new(),
        message_request: Some(MessageRequest::FileByFilename(filename.to_string())),
    }
}

fn map_status(st: tonic::Status) -> CoreError {
    match st.code() {
        Code::Unimplemented => CoreError::ReflectionDisabled {
            hint: format!("v1alpha unimplemented: {}", st.message()),
        },
        _ => CoreError::Reflection(format!("v1alpha status {:?}: {}", st.code(), st.message())),
    }
}

pub async fn list_and_fetch_files_v1alpha(
    channel: TonicChannel,
) -> Result<(Vec<String>, Vec<FileDescriptorProto>), CoreError> {
    algorithm::run(&V1AlphaAdapter, channel).await
}
