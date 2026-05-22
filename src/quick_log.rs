use std::env;
use std::fs;
use zed_extension_api::{self as zed, Command, LanguageServerId, Result, Worktree};

const SERVER_REL_PATH: &str = "quick-log-lsp/server.js";
const SERVER_BUNDLE: &str = include_str!("../server/dist/server.js");

struct QuickLogExtension {
    did_find_server: bool,
}

impl QuickLogExtension {
    fn file_exists(path: &str) -> bool {
        fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
    }

    fn ensure_server_installed(&mut self, id: &LanguageServerId) -> Result<String> {
        let work_dir = env::current_dir().map_err(|e| format!("failed to read work dir: {e}"))?;
        let server_path = work_dir.join(SERVER_REL_PATH);

        if self.did_find_server && Self::file_exists(SERVER_REL_PATH) {
            return Ok(server_path.to_string_lossy().into_owned());
        }

        zed::set_language_server_installation_status(
            id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );

        if Self::file_exists(SERVER_REL_PATH) {
            self.did_find_server = true;
            return Ok(server_path.to_string_lossy().into_owned());
        }

        zed::set_language_server_installation_status(
            id,
            &zed::LanguageServerInstallationStatus::Downloading,
        );

        if let Some(parent) = server_path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "failed to create embedded quick-log language server directory '{}': {e}",
                    parent.to_string_lossy()
                )
            })?;
        }

        fs::write(&server_path, SERVER_BUNDLE).map_err(|e| {
            format!(
                "failed to write embedded quick-log language server to '{}': {e}",
                server_path.to_string_lossy()
            )
        })?;

        if !Self::file_exists(SERVER_REL_PATH) {
            return Err(format!(
                "embedded quick-log language server was not written to '{}'",
                server_path.to_string_lossy()
            ));
        }

        self.did_find_server = true;
        Ok(server_path.to_string_lossy().into_owned())
    }
}

impl zed::Extension for QuickLogExtension {
    fn new() -> Self {
        Self {
            did_find_server: false,
        }
    }

    fn language_server_command(
        &mut self,
        id: &LanguageServerId,
        _worktree: &Worktree,
    ) -> Result<Command> {
        let server_path = self.ensure_server_installed(id)?;

        Ok(Command {
            command: zed::node_binary_path()?,
            args: vec![server_path, "--stdio".to_string()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(QuickLogExtension);
