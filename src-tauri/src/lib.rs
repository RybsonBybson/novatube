//! NovaTube backend: window setup, shared state and command registration.

pub mod binaries;
pub mod commands;
pub mod metadata;
pub mod models;
pub mod queue;
pub mod state;
pub mod store;
pub mod util;

use std::sync::Arc;

use tauri::{Manager, PhysicalPosition, PhysicalSize, WindowEvent};

use crate::binaries::Binaries;
use crate::queue::DownloadQueue;
use crate::state::AppState;
use crate::store::{AppStore, WindowState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let store = Arc::new(AppStore::new(&handle));
            let binaries = Arc::new(Binaries::new(handle.clone(), Arc::clone(&store)));
            let queue = Arc::new(DownloadQueue::new(
                handle.clone(),
                Arc::clone(&store),
                Arc::clone(&binaries),
            ));

            app.manage(AppState {
                store: Arc::clone(&store),
                binaries: Arc::clone(&binaries),
                queue: Arc::clone(&queue),
            });

            restore_window(&handle, &store);

            tauri::async_runtime::spawn(async move {
                if binaries.init().await.is_ok() {
                    binaries.maybe_auto_update().await;
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                save_window(window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::metadata_fetch,
            commands::downloads_list,
            commands::downloads_add,
            commands::downloads_add_many,
            commands::downloads_pause,
            commands::downloads_resume,
            commands::downloads_cancel,
            commands::downloads_retry,
            commands::downloads_remove,
            commands::downloads_clear_finished,
            commands::downloads_open_file,
            commands::downloads_open_folder,
            commands::history_list,
            commands::history_remove,
            commands::history_clear,
            commands::settings_get,
            commands::settings_update,
            commands::settings_pick_folder,
            commands::binaries_status,
            commands::binaries_update_ytdlp,
            commands::binaries_refresh,
            commands::app_info,
            commands::app_open_path,
            commands::app_open_external,
            commands::clipboard_read,
            commands::clipboard_write,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NovaTube");
}

fn restore_window(app: &tauri::AppHandle, store: &AppStore) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let state = store.window_state();
    let width = state.width.clamp(1040, 10000);
    let height = state.height.clamp(680, 10000);
    let _ = window.set_size(PhysicalSize::new(width, height));

    if let (Some(x), Some(y)) = (state.x, state.y) {
        if is_on_screen(&window, x, y, width, height) {
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
    }

    if state.maximized {
        let _ = window.maximize();
    }
    let _ = window.show();
    let _ = window.set_focus();
}

fn is_on_screen(window: &tauri::WebviewWindow, x: i32, y: i32, width: u32, height: u32) -> bool {
    let Ok(monitors) = window.available_monitors() else {
        return true;
    };
    if monitors.is_empty() {
        return true;
    }

    monitors.iter().any(|monitor| {
        let origin = monitor.position();
        let size = monitor.size();
        let overlap_x = x + width as i32 > origin.x + 48
            && x < origin.x + size.width as i32 - 48;
        let overlap_y = y + height as i32 > origin.y + 48
            && y < origin.y + size.height as i32 - 48;
        overlap_x && overlap_y
    })
}

fn save_window(window: &tauri::Window) {
    let Ok(position) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };
    let state = window.app_handle().state::<AppState>();
    state.store.save_window_state(WindowState {
        x: Some(position.x),
        y: Some(position.y),
        width: size.width,
        height: size.height,
        maximized: window.is_maximized().unwrap_or(false),
    });
}
