//! How the host starts the engine release it runs: the orchestrator in the
//! release's directory, run from that directory as the release's own start
//! scripts run it (build/scripts/package.sh in the engine repository), with
//! its state kept in a data directory of the host's choosing.

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

use super::config::orchestrator_file_name;
use super::sidecar::SidecarSpec;
use super::HostError;

/// The directory sceneManager serves its static assets from, as the
/// release's start scripts set it.
const ROOT_PATH_ENV: &str = "WOOFX3_ROOT_PATH";
/// Where the engine writes everything: databases, module storage, uploaded
/// modules, caches and logs. Without it the engine writes into its release
/// directory, which may be read-only and is replaced by every update.
const DATA_DIR_ENV: &str = "WOOFX3_DATA_DIR";

/// The orchestrator in `engine_dir`, keeping the engine's state in
/// `data_dir`. A release without an orchestrator is an error, so a wrong
/// `engineDir` stops the host at startup rather than turning into endless
/// restarts. So is a data directory that is not absolute (the engine refuses
/// one) or that lies inside the release: the orchestrator would then try to
/// copy the release's own data into it, which it refuses.
pub fn orchestrator_spec(engine_dir: &Path, data_dir: &Path) -> Result<SidecarSpec, HostError> {
    let program = engine_dir.join(orchestrator_file_name());
    if !program.is_file() {
        return Err(HostError::OrchestratorMissing(program));
    }
    if !data_dir.is_absolute() {
        return Err(HostError::DataDirNotAbsolute(data_dir.to_path_buf()));
    }
    if within(data_dir, engine_dir) {
        return Err(HostError::DataDirInsideEngine(data_dir.to_path_buf()));
    }
    Ok(SidecarSpec {
        program,
        args: Vec::new(),
        current_dir: engine_dir.to_path_buf(),
        env: vec![
            (
                OsString::from(ROOT_PATH_ENV),
                engine_dir.as_os_str().to_os_string(),
            ),
            (
                OsString::from(DATA_DIR_ENV),
                data_dir.as_os_str().to_os_string(),
            ),
        ],
    })
}

/// Whether `path` is `dir` or lies under it, however either is spelled: `.`
/// and `..` are resolved, each is resolved through the file system as far
/// as it exists (symbolic links, Windows short names), and on Windows the
/// rest is compared without regard to case, as the file system does.
fn within(path: &Path, dir: &Path) -> bool {
    within_resolved(&resolved(path), &resolved(dir), cfg!(windows))
}

fn within_resolved(path: &Path, dir: &Path, ignore_case: bool) -> bool {
    let mut path = path.components();
    for dir_part in dir.components() {
        let Some(path_part) = path.next() else {
            return false;
        };
        let (a, b) = (path_part.as_os_str(), dir_part.as_os_str());
        let same = if ignore_case {
            a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
        } else {
            a == b
        };
        if !same {
            return false;
        }
    }
    true
}

/// `path` with `.` and `..` resolved by its text, then with its longest
/// existing ancestor resolved by the file system. The data directory need
/// not exist yet, so the part that does not is kept as written.
fn resolved(path: &Path) -> PathBuf {
    let lexical = lexically_normalized(path);
    let mut existing = lexical.as_path();
    let mut missing = Vec::new();
    loop {
        if let Ok(canonical) = existing.canonicalize() {
            let mut out = canonical;
            out.extend(missing.iter().rev());
            return out;
        }
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                missing.push(name.to_os_string());
                existing = parent;
            }
            _ => return lexical,
        }
    }
}

fn lexically_normalized(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("woofx3-engine-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    fn release(name: &str) -> std::path::PathBuf {
        let dir = scratch(name);
        std::fs::write(dir.join(orchestrator_file_name()), b"").expect("write");
        dir
    }

    #[test]
    fn test_orchestrator_spec_runs_the_release_from_its_directory() {
        let dir = release("release");
        let data = scratch("release-data");
        let spec = orchestrator_spec(&dir, &data).expect("found");
        assert_eq!(spec.program, dir.join(orchestrator_file_name()));
        assert_eq!(spec.current_dir, dir);
        assert!(spec.args.is_empty());
        assert_eq!(
            spec.env,
            vec![
                (
                    OsString::from("WOOFX3_ROOT_PATH"),
                    dir.clone().into_os_string()
                ),
                (
                    OsString::from("WOOFX3_DATA_DIR"),
                    data.clone().into_os_string()
                ),
            ]
        );
        std::fs::remove_dir_all(&dir).expect("cleanup");
        std::fs::remove_dir_all(&data).expect("cleanup");
    }

    #[test]
    fn test_orchestrator_spec_refuses_a_directory_without_an_orchestrator() {
        let dir = scratch("empty");
        let data = std::env::temp_dir().join("woofx3-engine-empty-data");
        assert!(matches!(
            orchestrator_spec(&dir, &data),
            Err(HostError::OrchestratorMissing(path)) if path == dir.join(orchestrator_file_name())
        ));
        std::fs::create_dir_all(dir.join(orchestrator_file_name())).expect("mkdir");
        assert!(matches!(
            orchestrator_spec(&dir, &data),
            Err(HostError::OrchestratorMissing(_))
        ));
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn test_orchestrator_spec_refuses_a_data_directory_it_cannot_use() {
        let dir = release("bad-data");
        assert!(matches!(
            orchestrator_spec(&dir, Path::new("data")),
            Err(HostError::DataDirNotAbsolute(path)) if path == Path::new("data")
        ));
        assert!(matches!(
            orchestrator_spec(&dir, &dir.join("data")),
            Err(HostError::DataDirInsideEngine(_))
        ));
        assert!(matches!(
            orchestrator_spec(&dir, &dir),
            Err(HostError::DataDirInsideEngine(_))
        ));
        let name = dir.file_name().expect("a name");
        let around = dir.join("..").join(name).join("data");
        assert!(matches!(
            orchestrator_spec(&dir, &around),
            Err(HostError::DataDirInsideEngine(_))
        ));
        let detour = dir
            .parent()
            .expect("a parent")
            .join("elsewhere")
            .join("..")
            .join(name)
            .join("data");
        assert!(matches!(
            orchestrator_spec(&dir, &detour),
            Err(HostError::DataDirInsideEngine(_))
        ));
        #[cfg(unix)]
        {
            let link = dir.with_file_name(format!("{}-link", name.to_string_lossy()));
            let _ = std::fs::remove_file(&link);
            std::os::unix::fs::symlink(&dir, &link).expect("symlink");
            let through_link = orchestrator_spec(&dir, &link.join("data"));
            std::fs::remove_file(&link).expect("cleanup");
            assert!(matches!(
                through_link,
                Err(HostError::DataDirInsideEngine(_))
            ));
        }
        let dotted = dir.join(".").join("data");
        assert!(matches!(
            orchestrator_spec(&dir, &dotted),
            Err(HostError::DataDirInsideEngine(_))
        ));
        let sibling = dir.with_file_name(format!("{}-data", name.to_string_lossy()));
        assert!(orchestrator_spec(&dir, &sibling).is_ok());
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn test_within_resolved_compares_whole_components() {
        let cases = [
            ("/a/engine/data", "/a/engine", false, true),
            ("/a/engine", "/a/engine", false, true),
            ("/a/engine-data", "/a/engine", false, false),
            ("/a", "/a/engine", false, false),
            ("/A/Engine/data", "/a/engine", false, false),
            ("/A/Engine/data", "/a/engine", true, true),
            ("/a/ENGINE", "/a/engine", true, true),
            ("/a/engine2", "/a/engine", true, false),
        ];
        for (path, dir, ignore_case, inside) in cases {
            assert_eq!(
                within_resolved(Path::new(path), Path::new(dir), ignore_case),
                inside,
                "{path} in {dir}, ignoring case: {ignore_case}"
            );
        }
    }

    #[test]
    fn test_lexically_normalized_resolves_dots() {
        let cases = [
            ("/a/b/../c", "/a/c"),
            ("/a/./b", "/a/b"),
            ("/a/b/../../c/./d", "/c/d"),
            ("/a/b/", "/a/b"),
        ];
        for (written, normal) in cases {
            assert_eq!(
                lexically_normalized(Path::new(written)),
                Path::new(normal),
                "{written}"
            );
        }
    }
}
