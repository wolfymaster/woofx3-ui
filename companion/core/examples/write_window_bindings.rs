//! Writes the window's TypeScript bindings (companion/ui/src/generated) from
//! the Rust wire types.

use std::path::Path;

use woofx3_companion_core::window::{window_bindings, BINDINGS_FILE};

fn main() -> std::io::Result<()> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(BINDINGS_FILE);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&path, window_bindings())?;
    println!("wrote {}", path.display());
    Ok(())
}
