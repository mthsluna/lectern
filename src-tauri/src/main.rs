#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Lectern's native shell.
//!
//! Closing the window does not quit the app. The window and its WebView are
//! destroyed, which frees almost all of the memory, and Lectern keeps living
//! as a small icon in the system tray. Clicking the icon builds the window
//! again. The timer never depends on the window being open: it is stored as
//! timestamps, so nothing is lost while the interface is unloaded.

use std::{fs, path::PathBuf};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WebviewWindowBuilder, Wry,
};

const FILE: &str = "lectern.json";

struct TrayMenu {
    open: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn lang_of(json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .and_then(|v| v.get("lang")?.as_str().map(String::from))
        .unwrap_or_default()
}

fn tray_labels(lang: &str) -> (&'static str, &'static str) {
    match lang {
        "pt" => ("Abrir o Lectern", "Sair"),
        "es" => ("Abrir Lectern", "Salir"),
        "fr" => ("Ouvrir Lectern", "Quitter"),
        "de" => ("Lectern öffnen", "Beenden"),
        "ru" => ("Открыть Lectern", "Выйти"),
        "zh" => ("打开 Lectern", "退出"),
        "ja" => ("Lectern を開く", "終了"),
        "hi" => ("Lectern खोलें", "बंद करें"),
        "ar" => ("فتح Lectern", "خروج"),
        _ => ("Open Lectern", "Quit"),
    }
}

/// Focus the window if it exists, otherwise build it again from the config.
fn open_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    if let Some(cfg) = app.config().app.windows.first() {
        if let Ok(w) = WebviewWindowBuilder::from_config(app, cfg).and_then(|b| b.build()) {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

/// Returns the saved JSON document, or an empty string on first launch.
#[tauri::command]
fn load_data(app: AppHandle) -> Result<String, String> {
    let path = data_dir(&app)?.join(FILE);
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Writes atomically: temp file first, then rename over the old one.
#[tauri::command]
fn save_data(app: AppHandle, data: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let tmp = dir.join(format!("{FILE}.tmp"));
    fs::write(&tmp, &data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join(FILE)).map_err(|e| e.to_string())?;

    // Keep the tray menu in the language the user picked.
    if let Some(menu) = app.try_state::<TrayMenu>() {
        let (open, quit) = tray_labels(&lang_of(&data));
        let _ = menu.open.set_text(open);
        let _ = menu.quit.set_text(quit);
    }
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        // Launching Lectern again while it sits in the tray reopens the window.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| open_window(app)))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![load_data, save_data])
        .setup(|app| {
            let saved = fs::read_to_string(data_dir(app.handle())?.join(FILE)).unwrap_or_default();
            let (open_label, quit_label) = tray_labels(&lang_of(&saved));
            let open = MenuItem::with_id(app, "open", open_label, true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;

            TrayIconBuilder::with_id("lectern")
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("Lectern")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => open_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        open_window(tray.app_handle());
                    }
                })
                .build(app)?;

            app.manage(TrayMenu { open, quit });

            // The window starts hidden so that `--hidden` (used when Lectern opens
            // with Windows) can go straight to the tray without a flash.
            if let Some(w) = app.get_webview_window("main") {
                if std::env::args().any(|a| a == "--hidden") {
                    let _ = w.destroy();
                } else {
                    let _ = w.show();
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start Lectern");

    app.run(|_, event| {
        // The last window closing should not end the process; only "Quit" does.
        if let RunEvent::ExitRequested { api, code: None, .. } = event {
            api.prevent_exit();
        }
    });
}
