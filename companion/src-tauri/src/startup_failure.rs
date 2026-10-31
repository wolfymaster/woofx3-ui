//! Telling the person at this PC why the app could not start. A
//! release build has no console, so an error returned from setup would
//! vanish and the app would simply not open. Instead the reason goes
//! to a log file in the app's log directory and into a message box.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The file the reason is appended to, in the app's log directory.
pub const STARTUP_ERROR_LOG: &str = "startup-error.log";

/// Logs `reason` and shows it under `title`, then waits for the message box
/// to close.
pub fn report(log_dir: Option<&Path>, title: &str, reason: &str) {
    eprintln!("[companion] could not start: {reason}");
    let logged = match log_dir {
        Some(dir) => write_log(dir, reason).map_err(|err| err.to_string()),
        None => Err("the app's log directory is unknown".to_string()),
    };
    let where_logged = match &logged {
        Ok(path) => format!("This was also written to {}.", path.display()),
        Err(err) => {
            eprintln!("[companion] could not write the startup error log: {err}");
            "It could not be written to the log.".to_string()
        }
    };
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title(title)
        .set_description(format!("{reason}\n\n{where_logged}"))
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

/// Appends `reason` to the log in `dir`, creating both if needed.
fn write_log(dir: &Path, reason: &str) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(STARTUP_ERROR_LOG);
    let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
    writeln!(file, "could not start: {reason}")?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_write_log_appends_each_reason() {
        let dir = std::env::temp_dir().join(format!("woofx3-startup-log-{}", uuid::Uuid::new_v4()));
        let path = write_log(&dir, "first").expect("written");
        write_log(&dir, "second").expect("appended");
        assert_eq!(path, dir.join(STARTUP_ERROR_LOG));
        assert_eq!(
            std::fs::read_to_string(&path).expect("readable"),
            "could not start: first\ncould not start: second\n"
        );
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }
}
