use std::fs;
use std::process::Child;
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use tauri::Manager;

struct ServerState(Arc<Mutex<Option<Child>>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(ServerState(Arc::new(Mutex::new(None))))
    .setup(|_app| {
      if !cfg!(debug_assertions) {
        let resource_dir = _app
          .path()
          .resource_dir()
          .unwrap_or_else(|_| PathBuf::from("."));
        let base_resources = {
          let nested = resource_dir.join("resources");
          if nested.exists() { nested } else { resource_dir }
        };
        let app_dir = base_resources.join("slowburn-app");
        let server_js = app_dir.join("server.js");
        let bundled_node = base_resources.join("node");
        let homebrew_node = PathBuf::from("/opt/homebrew/bin/node");
        let node_bin = if bundled_node.exists() {
          bundled_node
        } else if homebrew_node.exists() {
          homebrew_node
        } else {
          PathBuf::from("node")
        };

        let data_dir = _app
          .path()
          .app_data_dir()
          .unwrap_or_else(|_| PathBuf::from("."));
        let _ = fs::create_dir_all(&data_dir);
        let db_path = data_dir.join("slowburn.db");
        if !db_path.exists() {
          let bundled_db = base_resources.join("slowburn.db");
          if bundled_db.exists() {
            let _ = fs::copy(bundled_db, &db_path);
          }
        }

        let mut cmd = std::process::Command::new(node_bin);
        cmd.arg(server_js)
          .current_dir(app_dir)
          .env("PORT", "3002")
          .env("NODE_ENV", "production")
          .env("DISABLE_LIVERELOAD", "1")
          .env("DB_PATH", db_path);
        match cmd.spawn() {
          Ok(child) => {
            let state = _app.state::<ServerState>();
            *state.0.lock().unwrap() = Some(child);
          }
          Err(err) => {
            eprintln!("Failed to start server: {err}");
          }
        }

        let app_handle = _app.handle().clone();
        std::thread::spawn(move || {
          let addr = "127.0.0.1:3002";
          for _ in 0..60 {
            if std::net::TcpStream::connect(addr).is_ok() {
              let window = app_handle
                .get_webview_window("main");
              if let Some(window) = window {
                if let Err(err) = window.eval("location.replace('http://127.0.0.1:3002');") {
                  eprintln!("Failed to navigate Slowburn window: {err}");
                }
              } else {
                eprintln!("Slowburn window not found for navigation");
              }
              return;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
          }
          eprintln!("Slowburn server did not become ready on {addr}");
        });
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { .. } = event {
        let app = window.app_handle();
        if app.webview_windows().len() == 1 {
          if let Some(state) = app.try_state::<ServerState>() {
            if let Some(mut child) = state.0.lock().unwrap().take() {
              let _ = child.kill();
              let _ = child.wait();
            }
          }
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
