//! How the host starts the engine release it runs: the orchestrator in the
//! release's directory, run from that directory, as the release's own start
//! scripts run it (build/scripts/package.sh in the engine repository).

use std::ffi::OsString;
use std::path::Path;

use super::config::orchestrator_file_name;
use super::sidecar::SidecarSpec;
use super::HostError;

/// The directory sceneManager serves its static assets from, as the
/// release's start scripts set it.
const ROOT_PATH_ENV: &str = "WOOFX3_ROOT_PATH";

/// The orchestrator in `engine_dir`, or an error when the release has none,
/// so a wrong `engineDir` stops the host at startup rather than turning
/// into endless restarts.
pub fn orchestrator_spec(engine_dir: &Path) -> Result<SidecarSpec, HostError> {
    let program = engine_dir.join(orchestrator_file_name());
    if !program.is_file() {
        return Err(HostError::OrchestratorMissing(program));
    }
    Ok(SidecarSpec {
        program,
        args: Vec::new(),
        current_dir: engine_dir.to_path_buf(),
        env: vec![(
            OsString::from(ROOT_PATH_ENV),
            engine_dir.as_os_str().to_os_string(),
        )],
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

    #[test]
    fn test_orchestrator_spec_runs_the_release_from_its_directory() {
        let dir = scratch("release");
        let program = dir.join(orchestrator_file_name());
        std::fs::write(&program, b"").expect("write");
        let spec = orchestrator_spec(&dir).expect("found");
        assert_eq!(spec.program, program);
        assert_eq!(spec.current_dir, dir);
        assert!(spec.args.is_empty());
        assert_eq!(
            spec.env,
            vec![(
                OsString::from("WOOFX3_ROOT_PATH"),
                dir.clone().into_os_string()
            )]
        );
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn test_orchestrator_spec_refuses_a_directory_without_an_orchestrator() {
        let dir = scratch("empty");
        assert!(matches!(
            orchestrator_spec(&dir),
            Err(HostError::OrchestratorMissing(path)) if path == dir.join(orchestrator_file_name())
        ));
        std::fs::create_dir_all(dir.join(orchestrator_file_name())).expect("mkdir");
        assert!(matches!(
            orchestrator_spec(&dir),
            Err(HostError::OrchestratorMissing(_))
        ));
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }
}
