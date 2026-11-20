//! The bridge between Lectern and its browser extension.
//!
//! Chrome, Edge and Brave talk to desktop apps through native messaging: the
//! browser starts a registered program and exchanges JSON with it over
//! stdin and stdout. Lectern is that program. When the browser starts
//! lectern.exe with the extension's origin as its first argument, it runs
//! this small host instead of the app: no window, no tray.
//!
//! The host reads the saved study data so the extension can show it, and
//! forwards buttons pressed in the extension to the running app by starting
//! `lectern.exe --remote <command>`, which the app's single-instance handler
//! receives. Only the Lectern extension is allowed to start the host.

use std::{
    env, fs,
    io::{self, Read, Write},
    os::windows::process::CommandExt,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime},
};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

pub const HOST_NAME: &str = "app.lectern.bridge";
pub const EXTENSION_ID: &str = "lfdloaajmppgncbnlknlkpgenfaopedh";
const IDENTIFIER: &str = "app.lectern.studytimer";
const COMMANDS: [&str; 6] = ["start", "pause", "resume", "stop", "toggle", "open"];

/// Every Chromium browser keeps its own list of native hosts.
const BROWSER_KEYS: [&str; 4] = [
    r"Software\Google\Chrome\NativeMessagingHosts",
    r"Software\Microsoft\Edge\NativeMessagingHosts",
    r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
    r"Software\Chromium\NativeMessagingHosts",
];

const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

fn data_dir() -> Option<PathBuf> {
    env::var_os("APPDATA").map(|d| PathBuf::from(d).join(IDENTIFIER))
}

fn data_file() -> Option<PathBuf> {
    data_dir().map(|d| d.join("lectern.json"))
}

/// True when a browser started this process as the extension's host.
pub fn is_host_launch() -> bool {
    env::args().nth(1).is_some_and(|a| a.starts_with("chrome-extension://"))
}

/* ---------- registration ---------- */

/// Writes the host manifest and lists it with every Chromium browser.
/// Safe to call on every start: it only rewrites what changed.
pub fn register() -> io::Result<()> {
    let exe = env::current_exe()?;
    let dir = data_dir().ok_or_else(|| io::Error::other("no APPDATA"))?;
    fs::create_dir_all(&dir)?;
    let manifest = dir.join("bridge.json");
    let body = serde_json::to_string_pretty(&serde_json::json!({
        "name": HOST_NAME,
        "description": "Lectern",
        "path": exe,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{EXTENSION_ID}/")],
    }))?;
    if fs::read_to_string(&manifest).ok().as_deref() != Some(body.as_str()) {
        fs::write(&manifest, body)?;
    }
    let hk = RegKey::predef(HKEY_CURRENT_USER);
    let target = manifest.display().to_string();
    for key in BROWSER_KEYS {
        let path = format!(r"{key}\{HOST_NAME}");
        if let Ok((k, _)) = hk.create_subkey(&path) {
            if k.get_value::<String, _>("").ok().as_deref() != Some(target.as_str()) {
                let _ = k.set_value("", &target);
            }
        }
    }
    Ok(())
}

/// Removes what `register` added.
pub fn unregister() {
    let hk = RegKey::predef(HKEY_CURRENT_USER);
    for key in BROWSER_KEYS {
        let _ = hk.delete_subkey_all(format!(r"{key}\{HOST_NAME}"));
    }
    if let Some(dir) = data_dir() {
        let _ = fs::remove_file(dir.join("bridge.json"));
    }
}

/* ---------- the host ---------- */

fn read_message(input: &mut impl Read) -> Option<serde_json::Value> {
    let mut len = [0u8; 4];
    input.read_exact(&mut len).ok()?;
    let len = u32::from_le_bytes(len) as usize;
    if len > 1 << 20 {
        return None;
    }
    let mut buf = vec![0u8; len];
    input.read_exact(&mut buf).ok()?;
    serde_json::from_slice(&buf).ok()
}

fn write_message(out: &Mutex<io::Stdout>, value: &serde_json::Value) {
    let body = value.to_string();
    let mut out = out.lock().unwrap();
    let _ = out.write_all(&(body.len() as u32).to_le_bytes());
    let _ = out.write_all(body.as_bytes());
    let _ = out.flush();
}

fn state_message() -> serde_json::Value {
    let data = data_file()
        .and_then(|f| fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .unwrap_or(serde_json::Value::Null);
    serde_json::json!({ "type": "state", "data": data, "now": now_ms() })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn modified() -> Option<SystemTime> {
    fs::metadata(data_file()?).ok()?.modified().ok()
}

/// Hands a command to the app. If Lectern is running, its single-instance
/// handler receives it; if not, Lectern starts quietly in the tray to run it.
fn forward(cmd: &str, subject: Option<&str>) -> io::Result<()> {
    let exe = env::current_exe()?;
    let mut args = vec!["--remote".to_string(), cmd.to_string()];
    if let Some(s) = subject {
        args.push("--subject".into());
        args.push(s.chars().take(40).collect());
    }
    let spawn = |flags: u32| {
        Command::new(&exe)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(flags)
            .spawn()
    };
    // Outlive the browser's job object, so closing the popup never closes Lectern.
    spawn(CREATE_BREAKAWAY_FROM_JOB).or_else(|_| spawn(0)).map(|_| ())
}

pub fn run_host() {
    let out = Arc::new(Mutex::new(io::stdout()));

    // Push the state whenever the app saves, for as long as the extension listens.
    {
        let out = Arc::clone(&out);
        thread::spawn(move || {
            let mut last = modified();
            loop {
                thread::sleep(Duration::from_millis(400));
                let now = modified();
                if now != last {
                    last = now;
                    write_message(&out, &state_message());
                }
            }
        });
    }

    let mut input = io::stdin().lock();
    while let Some(msg) = read_message(&mut input) {
        let reply = match msg.get("type").and_then(|t| t.as_str()) {
            Some("hello") => serde_json::json!({
                "type": "hello",
                "version": env!("CARGO_PKG_VERSION"),
            }),
            Some("state") => state_message(),
            Some("command") => {
                let cmd = msg.get("cmd").and_then(|c| c.as_str()).unwrap_or("");
                if COMMANDS.contains(&cmd) {
                    let subject = msg.get("subject").and_then(|s| s.as_str());
                    match forward(cmd, subject) {
                        Ok(()) => serde_json::json!({ "type": "ack", "cmd": cmd }),
                        Err(e) => serde_json::json!({ "type": "error", "error": e.to_string() }),
                    }
                } else {
                    serde_json::json!({ "type": "error", "error": "unknown command" })
                }
            }
            _ => serde_json::json!({ "type": "error", "error": "unknown message" }),
        };
        write_message(&out, &reply);
    }
}

/* ---------- remote commands, inside the app ---------- */

/// `--remote <cmd> [--subject <text>]` as JSON for the interface, if present.
pub fn parse_remote(args: &[String]) -> Option<(String, String)> {
    let i = args.iter().position(|a| a == "--remote")?;
    let cmd = args.get(i + 1).filter(|c| COMMANDS.contains(&c.as_str()))?.clone();
    let subject = args
        .iter()
        .position(|a| a == "--subject")
        .and_then(|j| args.get(j + 1));
    let json = serde_json::json!({ "cmd": cmd, "subject": subject }).to_string();
    Some((cmd, json))
}
