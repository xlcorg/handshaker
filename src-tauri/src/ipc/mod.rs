pub mod auth;
pub mod catalog;
pub mod collection;
pub mod env;
pub mod error;
pub mod invoke;
pub mod target;
pub mod vars;

pub use auth::AuthCredentialsIpc;
pub use catalog::ServiceCatalogIpc;
pub use error::IpcError;
pub use invoke::{InvokeOutcomeIpc, InvokeRequest};
pub use target::GrpcTargetIpc;
