#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Lectern Setup: a small installer with the same look as the app.
//!
//! It installs per user (no administrator prompt) into
//! `%LOCALAPPDATA%\Lectern`, the same place the earlier NSIS installer used,
//! so it upgrades an existing install in place. A copy of this program is
//! left behind as `uninstall.exe`; started with `--uninstall`, it removes
//! Lectern again.

use serde::Serialize;
use std::{
    fs,
    io::Read,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    thread::sleep,
    time::Duration,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const PAYLOAD: &[u8] = include_bytes!("../../payload/lectern.exe.gz");
const VERSION: &str = env!("CARGO_PKG_VERSION");
const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Lectern";
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APP_ID: &str = "app.lectern.studytimer";
const NO_WINDOW: u32 = 0x0800_0000;
const DETACHED: u32 = 0x0000_0008;

type Res<T = ()> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/* ---------- places ---------- */

fn install_dir() -> PathBuf {
    dirs::data_local_dir().expect("local app data").join("Lectern")
}
fn app_exe() -> PathBuf {
    install_dir().join("lectern.exe")
}
fn uninstaller() -> PathBuf {
    install_dir().join("uninstall.exe")
}
fn start_menu_link() -> PathBuf {
    dirs::data_dir()
        .expect("app data")
        .join(r"Microsoft\Windows\Start Menu\Programs\Lectern.lnk")
}
fn desktop_link() -> Option<PathBuf> {
    dirs::desktop_dir().map(|d| d.join("Lectern.lnk"))
}
/// Where the app keeps its study history.
fn data_dir() -> PathBuf {
    dirs::data_dir().expect("app data").join(APP_ID)
}
/// WebView cache of the app (safe to delete).
fn webview_dir() -> PathBuf {
    dirs::data_local_dir().expect("local app data").join(APP_ID)
}

fn uninstalling() -> bool {
    std::env::args().any(|a| a == "--uninstall")
}

/* ---------- context for the UI ---------- */

#[derive(Serialize)]
struct Context {
    mode: &'static str,
    version: &'static str,
    installed: Option<String>,
    dir: String,
    desktop: bool,
    startup: bool,
    lang: Option<String>,
    theme: Option<String>,
}

#[tauri::command]
fn context() -> Context {
    let hk = RegKey::predef(HKEY_CURRENT_USER);
    let installed = hk
        .open_subkey(UNINSTALL_KEY)
        .ok()
        .and_then(|k| k.get_value::<String, _>("DisplayVersion").ok());
    let startup = hk
        .open_subkey(RUN_KEY)
        .ok()
        .and_then(|k| k.get_value::<String, _>("Lectern").ok())
        .is_some();
    let desktop = desktop_link().map(|p| p.exists()).unwrap_or(false);

    // Speak the language and wear the theme the user already chose in the app.
    let saved: serde_json::Value = fs::read_to_string(data_dir().join("lectern.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let pick = |k: &str| saved.get(k).and_then(|v| v.as_str()).map(String::from);

    let mode = if uninstalling() {
        "uninstall"
    } else if installed.is_some() && app_exe().exists() {
        "update"
    } else {
        "install"
    };
    Context {
        mode,
        version: VERSION,
        installed,
        dir: install_dir().display().to_string(),
        desktop,
        startup,
        lang: pick("lang"),
        theme: pick("theme"),
    }
}

/* ---------- install steps (called one by one so the UI can show progress) ---------- */

/// A running Lectern holds its executable open. Its timer is stored as
/// timestamps, so closing it loses nothing.
#[tauri::command]
fn close_running() {
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "lectern.exe"])
        .creation_flags(NO_WINDOW)
        .status();
    sleep(Duration::from_millis(400));
}

fn write_replacing(path: &Path, bytes: &[u8]) -> Res {
    let tmp = path.with_extension("new");
    fs::write(&tmp, bytes).map_err(err)?;
    // The old executable may need a moment to be released after taskkill.
    for _ in 0..25 {
        if fs::rename(&tmp, path).is_ok() {
            return Ok(());
        }
        sleep(Duration::from_millis(200));
    }
    let _ = fs::remove_file(&tmp);
    Err(format!("Could not replace {}", path.display()))
}

#[tauri::command]
fn copy_files() -> Res {
    fs::create_dir_all(install_dir()).map_err(err)?;
    let mut exe = Vec::with_capacity(4 << 20);
    flate2::read::GzDecoder::new(PAYLOAD)
        .read_to_end(&mut exe)
        .map_err(err)?;
    write_replacing(&app_exe(), &exe)?;

    // The uninstaller is this very program.
    let me = std::env::current_exe().map_err(err)?;
    if me != uninstaller() {
        write_replacing(&uninstaller(), &fs::read(&me).map_err(err)?)?;
    }
    Ok(())
}

fn make_link(at: &Path) -> Res {
    if let Some(parent) = at.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let target = app_exe();
    let mut link = mslnk::ShellLink::new(&target).map_err(err)?;
    link.set_working_dir(Some(install_dir().display().to_string()));
    link.set_icon_location(Some(target.display().to_string()));
    link.create_lnk(at).map_err(err)
}

#[tauri::command]
fn shortcuts(desktop: bool) -> Res {
    make_link(&start_menu_link())?;
    if let Some(link) = desktop_link() {
        if desktop {
            make_link(&link)?;
        } else {
            let _ = fs::remove_file(link);
        }
    }
    Ok(())
}

#[tauri::command]
fn register(startup: bool) -> Res {
    let hk = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hk.create_subkey(UNINSTALL_KEY).map_err(err)?;
    let exe = app_exe();
    let size_kb = [exe.clone(), uninstaller()]
        .iter()
        .filter_map(|p| fs::metadata(p).ok())
        .map(|m| m.len())
        .sum::<u64>()
        / 1024;

    key.set_value("DisplayName", &"Lectern").map_err(err)?;
    key.set_value("DisplayVersion", &VERSION).map_err(err)?;
    key.set_value("Publisher", &"Lectern").map_err(err)?;
    key.set_value("DisplayIcon", &format!("\"{}\"", exe.display())).map_err(err)?;
    key.set_value("InstallLocation", &install_dir().display().to_string()).map_err(err)?;
    key.set_value("UninstallString", &format!("\"{}\" --uninstall", uninstaller().display())).map_err(err)?;
    key.set_value("EstimatedSize", &(size_kb as u32)).map_err(err)?;
    key.set_value("NoModify", &1u32).map_err(err)?;
    key.set_value("NoRepair", &1u32).map_err(err)?;
    let _ = key.delete_value("QuietUninstallString");

    // Leftover from the NSIS installer used up to 1.6.
    let _ = hk.delete_subkey_all(r"Software\lectern");

    let (run, _) = hk.create_subkey(RUN_KEY).map_err(err)?;
    if startup {
        run.set_value("Lectern", &format!("\"{}\" --hidden", exe.display())).map_err(err)?;
    } else {
        let _ = run.delete_value("Lectern");
    }
    Ok(())
}

#[tauri::command]
fn launch() -> Res {
    Command::new(app_exe())
        .current_dir(install_dir())
        .creation_flags(DETACHED)
        .spawn()
        .map(|_| ())
        .map_err(err)
}

/* ---------- uninstall ---------- */

#[tauri::command]
fn uninstall(keep_data: bool) -> Res {
    close_running();

    let _ = fs::remove_file(start_menu_link());
    if let Some(link) = desktop_link() {
        let _ = fs::remove_file(link);
    }
    let hk = RegKey::predef(HKEY_CURRENT_USER);
    let _ = hk.delete_subkey_all(UNINSTALL_KEY);
    let _ = hk.delete_subkey_all(r"Software\lectern");
    if let Ok(run) = hk.open_subkey_with_flags(RUN_KEY, winreg::enums::KEY_SET_VALUE) {
        let _ = run.delete_value("Lectern");
    }

    let _ = fs::remove_dir_all(webview_dir());
    if !keep_data {
        let _ = fs::remove_dir_all(data_dir());
    }
    let _ = fs::remove_file(app_exe());

    // This program is uninstall.exe inside the folder, so the folder is
    // removed a moment after it exits.
    let dir = install_dir();
    Command::new("cmd")
        .raw_arg(format!(
            "/C ping 127.0.0.1 -n 3 > nul & rmdir /S /Q \"{}\"",
            dir.display()
        ))
        .creation_flags(NO_WINDOW | DETACHED)
        .spawn()
        .map_err(err)?;
    Ok(())
}

/* ---------- silent mode ---------- */

/// `--silent` installs (or, with `--uninstall`, removes) without a window,
/// keeping the user's current shortcut and startup choices and their data.
/// Useful for scripted installs, and runs exactly the steps the UI runs.
fn silent() -> Res {
    if uninstalling() {
        return uninstall(true);
    }
    let ctx = context();
    close_running();
    copy_files()?;
    shortcuts(ctx.desktop)?;
    register(ctx.startup)?;
    // used by the in-app updater: bring Lectern back once it is replaced
    if std::env::args().any(|a| a == "--relaunch") {
        launch()?;
    }
    Ok(())
}

/* ---------- window ---------- */

fn main() {
    if std::env::args().any(|a| a == "--silent") {
        let code = match silent() {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("{e}");
                1
            }
        };
        std::process::exit(code);
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            context,
            close_running,
            copy_files,
            shortcuts,
            register,
            launch,
            uninstall
        ])
        .setup(|app| {
            // Keep the setup's own WebView files out of the user's profile.
            let scratch = std::env::temp_dir().join("lectern-setup");
            WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("index.html".into()))
                .title("Lectern Setup")
                .inner_size(440.0, 560.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .shadow(true)
                .center()
                .background_color(tauri::window::Color(250, 249, 245, 255))
                .data_directory(scratch)
                .build()?;
            let _ = app.get_webview_window("setup").map(|w| w.set_focus());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start Lectern Setup");
}
