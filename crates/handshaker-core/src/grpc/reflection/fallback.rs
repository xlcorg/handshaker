//! v1 → v1alpha fallback. The CALLER passes a `TonicChannel` and gets back the union of
//! services + descriptors. We try v1 first; on `ReflectionDisabled` we retry with v1alpha.
//!
//! If BOTH versions are unimplemented, we surface a single `ReflectionDisabled` with a
//! hint that mentions both versions.

use crate::error::CoreError;
use crate::grpc::reflection::v1::list_and_fetch_files_v1;
use crate::grpc::reflection::v1alpha::list_and_fetch_files_v1alpha;
use crate::grpc::transport::TonicChannel;
use prost_types::FileDescriptorProto;

pub async fn list_and_fetch_files(
    channel: TonicChannel,
) -> Result<(Vec<String>, Vec<FileDescriptorProto>), CoreError> {
    match list_and_fetch_files_v1(channel.clone()).await {
        Ok(ok) => Ok(ok),
        Err(CoreError::ReflectionDisabled { hint: v1_hint }) => {
            match list_and_fetch_files_v1alpha(channel).await {
                Ok(ok) => Ok(ok),
                Err(CoreError::ReflectionDisabled { hint: alpha_hint }) => {
                    Err(CoreError::ReflectionDisabled {
                        hint: format!(
                            "neither v1 nor v1alpha reflection is enabled on the target \
                             (v1: {v1_hint}; v1alpha: {alpha_hint}). Enable Server Reflection \
                             on the server, then retry."
                        ),
                    })
                }
                Err(other) => Err(other),
            }
        }
        Err(other) => Err(other),
    }
}
