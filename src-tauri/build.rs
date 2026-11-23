fn main() {
    emit_app_version();
    tauri_build::build();
}

/// `tauri.conf.json` is the source of truth for the app version: CI stamps it
/// per release. Mirror it into a compile-time environment variable so the
/// headless CLI's `--version` reports exactly the same number as the window.
fn emit_app_version() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    let path = std::path::Path::new(&manifest_dir).join("tauri.conf.json");
    println!("cargo:rerun-if-changed={}", path.display());

    let version = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|json| json.get("version")?.as_str().map(str::to_string))
        .unwrap_or_else(|| std::env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.0.0".into()));

    println!("cargo:rustc-env=NOVATUBE_VERSION={version}");
}
