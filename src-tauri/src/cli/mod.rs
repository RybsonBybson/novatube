//! Headless CLI entry point.
//!
//! `main` calls `run()` once. With no arguments the normal Tauri window opens;
//! with any argument the process is parsed as a CLI command and exits without
//! ever creating a webview.

mod args;
mod download;
mod inspect;
mod output;
mod paths;

use std::ffi::OsString;

use clap::Parser;

use args::{Cli, Command};

/// Returns an exit code when the process was invoked as a CLI, or `None` when
/// the GUI should start.
pub fn maybe_run() -> Option<i32> {
    let arguments: Vec<OsString> = std::env::args_os().collect();
    if arguments.len() <= 1 {
        return None;
    }

    // Release builds are windowed binaries: reattach stdio so terminal runs and
    // subprocesses see output. Inherited pipes are left untouched.
    crate::sys::attach_parent_console();

    Some(run_arguments(arguments))
}

fn run_arguments(arguments: Vec<OsString>) -> i32 {
    let cli = match Cli::try_parse_from(arguments) {
        Ok(cli) => cli,
        Err(error) => {
            let code = error.exit_code();
            let _ = error.print();
            return code;
        }
    };

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("error: could not start the async runtime: {error}");
            return 1;
        }
    };

    runtime.block_on(async move {
        let result = match cli.command {
            Command::Download(args) => download::run(*args).await,
            Command::Info(args) => inspect::run_info(args).await,
            Command::Search(args) => inspect::run_search(args).await,
        };

        match result {
            Ok(code) => code,
            Err(error) => {
                eprintln!("error: {error}");
                error.code
            }
        }
    })
}
