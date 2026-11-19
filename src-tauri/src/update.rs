//! Updates from GitHub releases.
//!
//! On launch the interface asks whether a newer release exists. Nothing is
//! downloaded until the user chooses to update. The installer is fetched only
//! from this repository's releases, checked against the SHA-256 digest that
//! GitHub publishes for it, then run silently; it closes Lectern, replaces it
//! and opens it again.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, os::windows::process::CommandExt, process::Command, time::Duration};

const REPO: &str = "mthsluna/lectern";
const USER_AGENT: &str = "Lectern-updater";
const DETACHED: u32 = 0x0000_0008;
const MAX_DOWNLOAD: u64 = 64 << 20;

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Update {
    version: String,
    url: String,
    size: u64,
    digest: Option<String>,
}

/// The running version. `LECTERN_UPDATE_TEST_VERSION` pretends to be older,
/// which is how the update flow is tested against a real release.
fn current() -> String {
    std::env::var("LECTERN_UPDATE_TEST_VERSION").unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string())
}

fn parse(v: &str) -> (u64, u64, u64) {
    let mut parts = v
        .trim_start_matches('v')
        .split(['.', '-'])
        .map(|p| p.parse().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(8))
        .timeout(Duration::from_secs(120))
        .user_agent(USER_AGENT)
        .build()
}

#[tauri::command(async)]
pub fn check_update() -> Result<Option<Update>, String> {
    let release: Release = agent()
        .get(&format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;

    if release.draft || release.prerelease || parse(&release.tag_name) <= parse(&current()) {
        return Ok(None);
    }
    let asset = release
        .assets
        .into_iter()
        .find(|a| a.name.starts_with("Lectern-Setup") && a.name.ends_with(".exe"));
    Ok(asset.map(|a| Update {
        version: release.tag_name.trim_start_matches('v').to_string(),
        url: a.browser_download_url,
        size: a.size,
        digest: a.digest,
    }))
}

#[tauri::command(async)]
pub fn install_update(app: tauri::AppHandle, update: Update) -> Result<(), String> {
    let prefix = format!("https://github.com/{REPO}/releases/download/");
    if !update.url.starts_with(&prefix) {
        return Err("Unexpected download address".into());
    }

    let mut bytes = Vec::with_capacity(update.size as usize);
    agent()
        .get(&update.url)
        .call()
        .map_err(|e| e.to_string())?
        .into_reader()
        .take(MAX_DOWNLOAD)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;

    if let Some(expected) = update.digest.as_deref().and_then(|d| d.strip_prefix("sha256:")) {
        let actual: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
        if !actual.eq_ignore_ascii_case(expected) {
            return Err("The download did not pass verification".into());
        }
    }

    let path = std::env::temp_dir().join(format!("Lectern-Setup-{}.exe", update.version));
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Command::new(&path)
        .args(["--silent", "--relaunch"])
        .creation_flags(DETACHED)
        .spawn()
        .map_err(|e| e.to_string())?;

    // The installer closes and replaces this process; leave quietly first.
    app.exit(0);
    Ok(())
}
