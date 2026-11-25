//! Dependency-free entry point for staged development checks.
fn main() -> std::process::ExitCode {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let python = if cfg!(windows) { "python" } else { "python3" };
    match std::process::Command::new(python)
        .arg(root.join("scripts/verify.py"))
        .args(std::env::args_os().skip(1))
        .current_dir(root)
        .status()
    {
        Ok(status) => std::process::ExitCode::from(
            status
                .code()
                .and_then(|code| u8::try_from(code).ok())
                .unwrap_or(1),
        ),
        Err(error) => {
            eprintln!("cannot start verification (Python 3 is required): {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
