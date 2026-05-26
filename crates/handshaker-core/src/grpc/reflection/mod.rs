//! gRPC Server Reflection client.
//!
//! Public API: `list_and_fetch_files_v1(channel)` (this task). Fallback wrapper
//! `list_and_fetch_files(channel)` lands in the next task.

pub(crate) mod algorithm;
pub mod v1;

pub use v1::list_and_fetch_files_v1;
