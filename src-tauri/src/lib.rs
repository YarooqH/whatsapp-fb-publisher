use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

struct NodeProcessState(Mutex<Option<Child>>);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn strip_unc(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path
    }
}

fn find_node_binary() -> PathBuf {
    if let Ok(output) = Command::new("where.exe").arg("node").output() {
        if output.status.success() {
            let out_str = String::from_utf8_lossy(&output.stdout);
            if let Some(first_line) = out_str.lines().next() {
                let trimmed = first_line.trim();
                if !trimmed.is_empty() && Path::new(trimmed).exists() {
                    return PathBuf::from(trimmed);
                }
            }
        }
    }

    let fallbacks = [
        r"C:\nvm4w\nodejs\node.exe",
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Program Files (x86)\nodejs\node.exe",
    ];

    for path in &fallbacks {
        let p = Path::new(path);
        if p.exists() {
            return p.to_path_buf();
        }
    }

    PathBuf::from("node")
}

fn find_service_and_cwd() -> Option<(PathBuf, PathBuf)> {
    // Relative to current working directory (e.g. from src-tauri or project root)
    let cwd_candidates = [
        ("..", "../src/service.js"),
        (".", "src/service.js"),
        ("../..", "../../src/service.js"),
    ];

    for (cwd_rel, script_rel) in &cwd_candidates {
        let script = Path::new(script_rel);
        let cwd = Path::new(cwd_rel);
        if script.exists() && cwd.exists() {
            if let (Ok(abs_script), Ok(abs_cwd)) = (script.canonicalize(), cwd.canonicalize()) {
                return Some((strip_unc(abs_script), strip_unc(abs_cwd)));
            }
        }
    }

    // Relative to current executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let exe_candidates = [
                (exe_dir.join(".."), exe_dir.join("../src/service.js")),
                (exe_dir.join("../.."), exe_dir.join("../../src/service.js")),
                (exe_dir.join("../../.."), exe_dir.join("../../../src/service.js")),
                (exe_dir.to_path_buf(), exe_dir.join("src/service.js")),
                (exe_dir.to_path_buf(), exe_dir.join("service.js")),
            ];
            for (cwd, script) in &exe_candidates {
                if script.exists() && cwd.exists() {
                    let final_script = script.canonicalize().map(strip_unc).unwrap_or_else(|_| script.clone());
                    let final_cwd = cwd.canonicalize().map(strip_unc).unwrap_or_else(|_| cwd.clone());
                    return Some((final_script, final_cwd));
                }
            }
        }
    }

    None
}

fn find_runtime(app: &tauri::App) -> Option<(PathBuf, PathBuf, PathBuf)> {
    // Returns (node_binary, service_script, working_directory)

    // 1. Check bundled resource directory (Installed application via NSIS / MSI)
    if let Ok(res_dir) = app.path().resource_dir() {
        let node_candidates = [
            res_dir.join("bin/node.exe"),
            res_dir.join("node.exe"),
        ];
        let service_candidates = [
            (res_dir.clone(), res_dir.join("dist/service.js")),
            (res_dir.clone(), res_dir.join("src/service.js")),
            (res_dir.clone(), res_dir.join("service.js")),
        ];
        for node in &node_candidates {
            if node.exists() {
                for (cwd, script) in &service_candidates {
                    if script.exists() && cwd.exists() {
                        return Some((strip_unc(node.clone()), strip_unc(script.clone()), strip_unc(cwd.clone())));
                    }
                }
            }
        }
    }

    // 2. Check relative to current executable directory (Portable / extracted folder)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let node_candidates = [
                exe_dir.join("bin/node.exe"),
                exe_dir.join("node.exe"),
                exe_dir.join("../bin/node.exe"),
            ];
            let service_candidates = [
                (exe_dir.to_path_buf(), exe_dir.join("dist/service.js")),
                (exe_dir.to_path_buf(), exe_dir.join("src/service.js")),
                (exe_dir.to_path_buf(), exe_dir.join("service.js")),
                (exe_dir.join(".."), exe_dir.join("../dist/service.js")),
                (exe_dir.join(".."), exe_dir.join("../src/service.js")),
                (exe_dir.join("../.."), exe_dir.join("../../dist/service.js")),
                (exe_dir.join("../.."), exe_dir.join("../../src/service.js")),
                (exe_dir.join("../../.."), exe_dir.join("../../../dist/service.js")),
                (exe_dir.join("../../.."), exe_dir.join("../../../src/service.js")),
            ];
            for node in &node_candidates {
                if node.exists() {
                    for (cwd, script) in &service_candidates {
                        if script.exists() && cwd.exists() {
                            let n = node.canonicalize().map(strip_unc).unwrap_or_else(|_| node.clone());
                            let s = script.canonicalize().map(strip_unc).unwrap_or_else(|_| script.clone());
                            let c = cwd.canonicalize().map(strip_unc).unwrap_or_else(|_| cwd.clone());
                            return Some((n, s, c));
                        }
                    }
                }
            }
        }
    }

    // 3. Fallback to system node and relative candidate paths (Development mode)
    let node_bin = find_node_binary();
    if let Some((script_path, cwd_path)) = find_service_and_cwd() {
        return Some((node_bin, script_path, cwd_path));
    }

    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .manage(NodeProcessState(Mutex::new(None)))
        .setup(|app| {
            // Determine user data directory
            let app_data_dir = match app.path().app_data_dir() {
                Ok(path) => path.to_string_lossy().to_string(),
                Err(_) => ".".to_string(),
            };

            // Check if service is already running on 127.0.0.1:41738
            let is_already_running = TcpStream::connect("127.0.0.1:41738").is_ok();

            if !is_already_running {
                if let Some((node_bin, script_path, cwd_path)) = find_runtime(app) {
                    println!("🚀 Spawning Relay Service: {:?} with {:?} (cwd: {:?})", script_path, node_bin, cwd_path);

                    let _ = std::fs::create_dir_all(&app_data_dir);
                    let log_path = Path::new(&app_data_dir).join("service.log");

                    // Rotate log if it exceeds 2MB to prevent unbounded disk growth
                    if let Ok(meta) = std::fs::metadata(&log_path) {
                        if meta.len() > 2 * 1024 * 1024 {
                            let backup_path = Path::new(&app_data_dir).join("service.log.old");
                            let _ = std::fs::rename(&log_path, backup_path);
                        }
                    }

                    let mut cmd = Command::new(&node_bin);
                    cmd.arg("--max-old-space-size=64")
                        .arg("--max-semi-space-size=2")
                        .arg("--optimize-for-size")
                        .arg(&script_path)
                        .current_dir(&cwd_path)
                        .env("PUBLISHER_DATA_DIR", &app_data_dir);

                    #[cfg(windows)]
                    cmd.creation_flags(CREATE_NO_WINDOW);

                    if let Ok(file) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
                        if let Ok(file_err) = file.try_clone() {
                            cmd.stdout(file);
                            cmd.stderr(file_err);
                        }
                    }

                    match cmd.spawn() {
                        Ok(c) => {
                            if let Ok(mut state) = app.state::<NodeProcessState>().0.lock() {
                                *state = Some(c);
                            }
                        }
                        Err(err) => {
                            eprintln!("✖ Failed to spawn node service: {}", err);
                        }
                    }
                } else {
                    eprintln!("✖ Could not locate Node runtime or service.js!");
                }
            } else {
                println!("✓ Publisher service is already active on 127.0.0.1:41738");
            }

            // Create System Tray
            let show_i = MenuItem::with_id(app, "show", "Open Relay", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Relay", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Relay")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                let _ = tray.icon(icon.clone()).build(app);
            } else {
                let _ = tray.build(app);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<NodeProcessState>() {
                    if let Ok(mut lock) = state.0.lock() {
                        if let Some(mut child) = lock.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}
