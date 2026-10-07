//! A random id for this install of the companion, so pairing the same PC
//! with an instance again replaces its companion rather than adding one.
//! It identifies, it does not authenticate, so it lives in the app data
//! directory and not in the credential store.

use std::fs;
use std::path::Path;

use anyhow::{Context, Result};

const FILE_NAME: &str = "installation-id";

/// Reads the id from `dir`, creating it on first use.
pub fn load_or_create(dir: &Path) -> Result<String> {
    let path = dir.join(FILE_NAME);
    if let Ok(existing) = fs::read_to_string(&path) {
        if let Ok(parsed) = uuid::Uuid::parse_str(existing.trim()) {
            return Ok(parsed.hyphenated().to_string());
        }
    }
    fs::create_dir_all(dir).with_context(|| format!("could not create {}", dir.display()))?;
    let id = uuid::Uuid::new_v4().hyphenated().to_string();
    fs::write(&path, &id).with_context(|| format!("could not write {}", path.display()))?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_once_then_reads_back() {
        let dir =
            std::env::temp_dir().join(format!("woofx3-companion-test-{}", uuid::Uuid::new_v4()));
        let first = load_or_create(&dir).expect("create");
        assert_eq!(first, first.to_ascii_lowercase());
        assert!(uuid::Uuid::parse_str(&first).is_ok());
        assert_eq!(load_or_create(&dir).expect("read"), first);
        fs::remove_dir_all(&dir).ok();
    }
}
