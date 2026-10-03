/// The Convex deployment the companion talks to is compiled in, so a binary
/// can never point at the wrong deployment by accident. A release build
/// without `WOOFX3_CONVEX_URL` fails. A debug build (including `cargo test`
/// and `cargo clippy`) falls back to a local Convex backend, so checking the
/// crate needs no deployment.
const DEBUG_CONVEX_URL: &str = "http://127.0.0.1:3210";

fn main() {
    println!("cargo:rerun-if-env-changed=WOOFX3_CONVEX_URL");
    let configured = std::env::var("WOOFX3_CONVEX_URL")
        .ok()
        .filter(|url| !url.trim().is_empty());
    let url = match configured {
        Some(url) => url,
        None => {
            let profile = std::env::var("PROFILE").unwrap_or_default();
            if profile == "release" {
                panic!("WOOFX3_CONVEX_URL must be set for a release build of the companion");
            }
            DEBUG_CONVEX_URL.to_string()
        }
    };
    println!("cargo:rustc-env=WOOFX3_CONVEX_URL={url}");

    tauri_build::build()
}
