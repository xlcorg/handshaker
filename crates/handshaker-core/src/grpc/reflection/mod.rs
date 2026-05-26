//! gRPC Server Reflection client.
//!
//! - `list_and_fetch_files_v1` — single-version entry point against v1.
//! - `list_and_fetch_files_v1alpha` — single-version entry point against v1alpha.
//! - `list_and_fetch_files` — production entry point: v1 first, fallback to v1alpha.

pub(crate) mod algorithm;
pub mod fallback;
pub mod v1;
pub mod v1alpha;

pub use fallback::list_and_fetch_files;
pub use v1::list_and_fetch_files_v1;
pub use v1alpha::list_and_fetch_files_v1alpha;
