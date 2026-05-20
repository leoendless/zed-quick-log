use std::env;
use std::fs;
use zed_extension_api::{self as zed, Command, LanguageServerId, Result, Worktree};

const LSP_PACKAGE_NAME: &str = "quick-log-lsp";
const SERVER_REL_PATH: &str = "node_modules/quick-log-lsp/dist/server.js";

struct QuickLogExtension {
    did_find_server: bool,
}

impl QuickLogExtension {
    fn ensure_server_installed(&mut self, id: &LanguageServerId) -> Result<()> {
        let server_exists = fs::metadata(SERVER_REL_PATH)
            .map(|m| m.is_file())
            .unwrap_or(false);

        if self.did_find_server && server_exists {
            return Ok(());
        }

        zed::set_language_server_installation_status(
            id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );

        let latest = zed::npm_package_latest_version(LSP_PACKAGE_NAME)
            .map_err(|e| format!("failed to query latest {LSP_PACKAGE_NAME}: {e}"))?;

        let installed = zed::npm_package_installed_version(LSP_PACKAGE_NAME)
            .map_err(|e| format!("failed to read installed {LSP_PACKAGE_NAME}: {e}"))?;

        let needs_install = !server_exists || installed.as_deref() != Some(latest.as_str());

        if needs_install {
            zed::set_language_server_installation_status(
                id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            zed::npm_install_package(LSP_PACKAGE_NAME, &latest)
                .map_err(|e| format!("failed to npm install {LSP_PACKAGE_NAME}@{latest}: {e}"))?;
        }

        if !fs::metadata(SERVER_REL_PATH)
            .map(|m| m.is_file())
            .unwrap_or(false)
        {
            return Err(format!(
                "installed package '{LSP_PACKAGE_NAME}' did not contain expected path '{SERVER_REL_PATH}'"
            ));
        }

        self.did_find_server = true;
        Ok(())
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
        self.ensure_server_installed(id)?;

        let work_dir =
            env::current_dir().map_err(|e| format!("failed to read work dir: {e}"))?;
        let server_path = work_dir.join(SERVER_REL_PATH);

        Ok(Command {
            command: zed::node_binary_path()?,
            args: vec![
                server_path.to_string_lossy().into_owned(),
                "--stdio".to_string(),
            ],
            env: Default::default(),
        })
    }
}

zed::register_extension!(QuickLogExtension);
