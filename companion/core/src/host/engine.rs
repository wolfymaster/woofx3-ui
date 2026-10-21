//! How the host starts the engine release it runs: the orchestrator in the
//! release's directory, run from that directory as the release's own start
//! scripts run it (build/scripts/package.sh in the engine repository), with
//! its state kept in a data directory of the host's choosing.

use std::ffi::OsString;
use std::path::Path;

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
    if data_dir.starts_with(engine_dir) {
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
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }
}
