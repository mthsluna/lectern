//! Setting up the browser extension from the app.
//!
//! Browsers do not let a program install an extension that is not in their
//! store, so Lectern does every step it may: it unpacks the extension into a
//! folder of its own, opens the browser on its extensions page, and the
//! interface puts the folder's path on the clipboard. The person turns on
//! developer mode, clicks "Load unpacked" and pastes.
//!
//! Browsers load an unpacked extension from its folder on every start, so
//! when the app updates, it refreshes that folder and the extension follows.

use std::{
    env, fs,
    io::{self, Cursor, Read},
    path::PathBuf,
    process::Command,
};

static PACKED: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/extension.zip"));

#[derive(serde::Serialize, Clone)]
pub struct Browser {
    pub id: &'static str,
    pub name: &'static str,
    #[serde(skip)]
    exe: PathBuf,
    #[serde(skip)]
    page: &'static str,
}

pub fn folder() -> Option<PathBuf> {
    env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("Lectern").join("extension"))
}

pub fn available() -> bool {
    !PACKED.is_empty()
}

fn archive() -> io::Result<zip::ZipArchive<Cursor<&'static [u8]>>> {
    zip::ZipArchive::new(Cursor::new(PACKED)).map_err(io::Error::other)
}

/// The version inside a manifest.json text.
fn version_of(manifest: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(manifest)
        .ok()?
        .get("version")?
        .as_str()
        .map(String::from)
}

fn packed_version() -> Option<String> {
    let mut zip = archive().ok()?;
    let name = ["./manifest.json", "manifest.json"]
        .into_iter()
        .find(|n| zip.index_for_name(n).is_some())?;
    let mut text = String::new();
    zip.by_name(name).ok()?.read_to_string(&mut text).ok()?;
    version_of(&text)
}

/// Writes the extension into its folder, replacing what was there.
pub fn unpack() -> io::Result<PathBuf> {
    let dir = folder().ok_or_else(|| io::Error::other("no LOCALAPPDATA"))?;
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
    fs::create_dir_all(&dir)?;
    let mut zip = archive()?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(io::Error::other)?;
        let Some(rel) = entry.enclosed_name() else { continue };
        let path = dir.join(rel);
        if entry.is_dir() {
            fs::create_dir_all(&path)?;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes)?;
        fs::write(&path, bytes)?;
    }
    Ok(dir)
}

/// After an update: if the extension was set up from here and is older than
/// the one inside the app, refresh its folder. The browser picks it up on
/// its next start.
pub fn refresh_if_installed() {
    let Some(dir) = folder() else { return };
    let Ok(text) = fs::read_to_string(dir.join("manifest.json")) else { return };
    if available() && version_of(&text) != packed_version() {
        let _ = unpack();
    }
}

/// Browsers that can run the extension, as installed on this computer.
pub fn browsers() -> Vec<Browser> {
    let pf = env::var_os("ProgramFiles").map(PathBuf::from);
    let pf86 = env::var_os("ProgramFiles(x86)").map(PathBuf::from);
    let local = env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let roots = [pf, pf86, local];
    let find = |rel: &str| roots.iter().flatten().map(|r| r.join(rel)).find(|p| p.exists());

    let known: [(&str, &str, &str, &str); 3] = [
        ("chrome", "Chrome", r"Google\Chrome\Application\chrome.exe", "chrome://extensions/"),
        ("edge", "Edge", r"Microsoft\Edge\Application\msedge.exe", "edge://extensions/"),
        ("brave", "Brave", r"BraveSoftware\Brave-Browser\Application\brave.exe", "brave://extensions/"),
    ];
    let mut list: Vec<Browser> = known
        .iter()
        .filter_map(|(id, name, rel, page)| {
            let file = rel.rsplit('\\').next().unwrap_or(rel);
            find(rel).or_else(|| app_path(file)).map(|exe| Browser { id, name, exe, page })
        })
        .collect();
    // the browser that opens web links comes first
    if let Some(first) = default_browser() {
        list.sort_by_key(|b| b.id != first);
    }
    list
}

/// Where Windows says a program lives (App Paths), if it says.
fn app_path(exe: &str) -> Option<PathBuf> {
    use winreg::{enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE}, RegKey};
    let key = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}");
    [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE].into_iter().find_map(|hive| {
        let path: String = RegKey::predef(hive).open_subkey(&key).ok()?.get_value("").ok()?;
        let p = PathBuf::from(path.trim_matches('"'));
        p.exists().then_some(p)
    })
}

/// The browser that opens web links, as a browser id.
fn default_browser() -> Option<&'static str> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let prog: String = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice")
        .ok()?
        .get_value("ProgId")
        .ok()?;
    let p = prog.to_lowercase();
    if p.starts_with("chrome") {
        Some("chrome")
    } else if p.starts_with("msedge") {
        Some("edge")
    } else if p.starts_with("brave") {
        Some("brave")
    } else {
        None
    }
}

/// Unpacks the extension and brings the browser forward. Browsers refuse to
/// open their own pages (brave://, chrome://) for another program, so the
/// interface hands the person that address to paste instead.
pub fn install(browser: &str) -> io::Result<(PathBuf, &'static str)> {
    let dir = unpack()?;
    let b = browsers()
        .into_iter()
        .find(|b| b.id == browser)
        .ok_or_else(|| io::Error::other("browser not found"))?;
    Command::new(&b.exe).spawn()?;
    Ok((dir, b.page))
}

/// Shows the extension's folder in File Explorer.
pub fn reveal() -> io::Result<()> {
    let dir = folder().ok_or_else(|| io::Error::other("no folder"))?;
    Command::new("explorer").arg(&dir).spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unpacks_and_refreshes() {
        let tmp = env::temp_dir().join(format!("lectern-ext-test-{}", std::process::id()));
        env::set_var("LOCALAPPDATA", &tmp);
        assert!(available(), "build the extension first: npm run build:extension");
        let dir = unpack().unwrap();
        let manifest = fs::read_to_string(dir.join("manifest.json")).unwrap();
        assert_eq!(version_of(&manifest), packed_version());
        assert!(dir.join("popup.html").exists() && dir.join("icons").join("icon-128.png").exists());

        // an older copy gets refreshed
        fs::write(dir.join("manifest.json"), r#"{"version":"0.0.1"}"#).unwrap();
        refresh_if_installed();
        let again = fs::read_to_string(dir.join("manifest.json")).unwrap();
        assert_eq!(version_of(&again), packed_version());

        let found: Vec<_> = browsers().iter().map(|b| b.name).collect();
        println!("browsers here: {found:?}");
        let _ = fs::remove_dir_all(&tmp);
    }
}
