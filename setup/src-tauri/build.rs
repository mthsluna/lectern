fn main() {
    // The installer embeds the app; fail early with a clear message if it is missing.
    let payload = std::path::Path::new("../payload/lectern.exe.gz");
    if !payload.exists() {
        panic!("setup/payload/lectern.exe.gz is missing. Run `npm run build` from the repository root.");
    }
    println!("cargo:rerun-if-changed=../payload/lectern.exe.gz");
    tauri_build::build()
}
