//! Reflection algorithm parametrised over a `ReflectionAdapter`.
//!
//! The two generated clients (`pb::v1::ServerReflectionClient`, `pb::v1alpha::ServerReflectionClient`)
//! have identical SHAPE but different concrete request/response types. We isolate the
//! tonic-specific bits behind `ReflectionAdapter` and write the streaming loop once.

use crate::error::CoreError;
use crate::grpc::transport::TonicChannel;
use async_trait::async_trait;
use prost::Message;
use prost_types::FileDescriptorProto;
use std::collections::{HashMap, HashSet, VecDeque};

#[async_trait]
pub(crate) trait ReflectionAdapter {
    /// Human-readable version label for error messages, e.g. "v1" / "v1alpha".
    fn version_label(&self) -> &'static str;

    /// Open a bidi `ServerReflectionInfo` stream and return:
    ///   - a sender we can push `MessageRequest`s into (`Send` items),
    ///   - a receiver that yields raw `FileDescriptorResponse` bytes batches OR error markers.
    ///
    /// The implementation drives the underlying tonic streaming client.
    async fn run_session(
        &self,
        channel: TonicChannel,
        plan: SessionPlan,
    ) -> Result<SessionOutcome, CoreError>;
}

/// One-shot plan: services to list (always `""`) + symbols to fetch + filenames to fetch.
/// We accumulate everything in memory and let the adapter execute the streaming dance.
pub(crate) struct SessionPlan {
    pub list_services: bool,
    pub symbols: Vec<String>,
    pub filenames: Vec<String>,
}

pub(crate) struct SessionOutcome {
    pub services: Vec<String>,
    /// Raw `FileDescriptorProto` bytes returned by the server (potentially with duplicates).
    pub file_proto_bytes: Vec<Vec<u8>>,
}

/// Top-level recipe: `list_services` → for each service, `file_containing_symbol(service)` →
/// for each returned file, follow `.dependency` until closure. Returns the decoded
/// deduplicated `FileDescriptorProto`s and the service list.
pub(crate) async fn run<A: ReflectionAdapter + Send + Sync>(
    adapter: &A,
    channel: TonicChannel,
) -> Result<(Vec<String>, Vec<FileDescriptorProto>), CoreError> {
    // Pass 1: list services.
    let listed = adapter
        .run_session(
            channel.clone(),
            SessionPlan {
                list_services: true,
                symbols: vec![],
                filenames: vec![],
            },
        )
        .await?;
    if listed.services.is_empty() {
        return Err(CoreError::Reflection(format!(
            "{} server returned empty service list",
            adapter.version_label()
        )));
    }

    // Pass 2: file_containing_symbol for each service. Then crawl dependencies.
    let pending_symbols = listed.services.clone();
    let fetched = adapter
        .run_session(
            channel.clone(),
            SessionPlan {
                list_services: false,
                symbols: pending_symbols,
                filenames: vec![],
            },
        )
        .await?;

    let mut by_name: HashMap<String, FileDescriptorProto> = HashMap::new();
    let mut queue: VecDeque<String> = VecDeque::new();
    let mut requested: HashSet<String> = HashSet::new();

    for bytes in &fetched.file_proto_bytes {
        let fdp = FileDescriptorProto::decode(&bytes[..]).map_err(|e| {
            CoreError::DescriptorBuild(format!(
                "decode FileDescriptorProto from {} server: {e}",
                adapter.version_label()
            ))
        })?;
        for dep in &fdp.dependency {
            if !requested.contains(dep) {
                queue.push_back(dep.clone());
                requested.insert(dep.clone());
            }
        }
        if let Some(name) = fdp.name.clone() {
            requested.insert(name.clone());
            by_name.insert(name, fdp);
        }
    }

    // Crawl dependencies until the queue drains.
    while !queue.is_empty() {
        let batch: Vec<String> = queue.drain(..).collect();
        let resp = adapter
            .run_session(
                channel.clone(),
                SessionPlan {
                    list_services: false,
                    symbols: vec![],
                    filenames: batch,
                },
            )
            .await?;
        for bytes in &resp.file_proto_bytes {
            let fdp = FileDescriptorProto::decode(&bytes[..]).map_err(|e| {
                CoreError::DescriptorBuild(format!(
                    "decode FileDescriptorProto from {} server: {e}",
                    adapter.version_label()
                ))
            })?;
            for dep in &fdp.dependency {
                if !requested.contains(dep) {
                    queue.push_back(dep.clone());
                    requested.insert(dep.clone());
                }
            }
            if let Some(name) = fdp.name.clone() {
                if !by_name.contains_key(&name) {
                    by_name.insert(name, fdp);
                }
            }
        }
    }

    let files = by_name.into_values().collect::<Vec<_>>();
    Ok((listed.services, files))
}
