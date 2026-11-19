#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const FILE: &str = "lectern.json";

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
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
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join(FILE)).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_data, save_data])
        .run(tauri::generate_context!())
        .expect("failed to start Lectern");
}
