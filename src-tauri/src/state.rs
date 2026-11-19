//! State shared by every Tauri command.

use std::sync::Arc;

use crate::binaries::Binaries;
use crate::queue::DownloadQueue;
use crate::store::AppStore;

pub struct AppState {
    pub store: Arc<AppStore>,
    pub binaries: Arc<Binaries>,
    pub queue: Arc<DownloadQueue>,
}
