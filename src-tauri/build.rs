use std::{env, fs, path::PathBuf};

fn main() {
    // The browser extension travels inside the app, so the app can set it up.
    // `npm run build` packs it first; without it the app simply offers the zip.
    let packed = PathBuf::from("../dist/Lectern-Extension.zip");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("extension.zip");
    match fs::read(&packed) {
        Ok(bytes) => fs::write(&out, bytes).unwrap(),
        Err(_) => fs::write(&out, []).unwrap(),
    }
    println!("cargo:rerun-if-changed=../dist/Lectern-Extension.zip");

    tauri_build::build()
}
