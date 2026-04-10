use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use rusqlite::Connection;
use tauri::{AppHandle, Manager};
use serde::{Deserialize, Serialize};

use super::auth::AuthStore;
use super::api::{build_router, SyncAppState};
use super::discovery;

const HTTP_PORT: u16 = 27182;

/// 全局服务器运行状态
pub struct SyncServerState {
    pub running: Arc<AtomicBool>,
    pub discovery_running: Arc<AtomicBool>,
    pub auth: AuthStore,
    pub port: u16,
}

impl SyncServerState {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            discovery_running: Arc::new(AtomicBool::new(false)),
            auth: AuthStore::new(),
            port: HTTP_PORT,
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct SyncStatusResponse {
    pub running: bool,
    pub port: u16,
    pub pin: Option<String>,
    pub local_ip: Option<String>,
}

/// Tauri 命令：启动同步服务器
#[tauri::command]
pub async fn start_sync_server(app: AppHandle) -> Result<SyncStatusResponse, String> {
    let sync_state = app.state::<Mutex<SyncServerState>>();
    
    // 先检查是否已经运行
    let (already_running, auth_clone, port) = {
        let state = sync_state.lock().unwrap();
        (
            state.running.load(Ordering::Relaxed),
            state.auth.clone(),
            state.port,
        )
    };

    if already_running {
        let pin = auth_clone.current_pin().or_else(|| Some(auth_clone.generate_pin()));
        return Ok(SyncStatusResponse {
            running: true,
            port,
            pin,
            local_ip: get_local_ip(),
        });
    }

    // 获取数据库路径，为 sync 服务单独开一个连接
    let db_path = get_db_path(&app)?;
    let db_arc: Arc<Mutex<Connection>> = {
        let new_conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| format!("Failed to open DB for sync: {}", e))?;
        // 初始化同步辅助表（WAL + sync_deleted_log）
        super::api::init_sync_tables(&new_conn)
            .map_err(|e| format!("Failed to init sync tables: {}", e))?;
        Arc::new(Mutex::new(new_conn))
    };

    // 获取设备名
    let device_name = get_device_name();

    // 构建 axum 应用状态
    let sync_app_state = SyncAppState {
        auth: auth_clone.clone(),
        db: db_arc,
        device_name: device_name.clone(),
    };

    let router = build_router(sync_app_state);
    let running_flag = {
        let state = sync_state.lock().unwrap();
        state.running.clone()
    };

    running_flag.store(true, Ordering::Relaxed);
    let running_flag_clone = running_flag.clone();

    // 在独立的 tokio 任务中启动 HTTP 服务
    tokio::spawn(async move {
        let addr = SocketAddr::from(([0, 0, 0, 0], HTTP_PORT));
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[SyncServer] Failed to bind: {}", e);
                running_flag_clone.store(false, Ordering::Relaxed);
                return;
            }
        };

        eprintln!("[SyncServer] Listening on {}", addr);

        // 使用带优雅关闭的 serve
        axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                while running_flag_clone.load(Ordering::Relaxed) {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                }
                eprintln!("[SyncServer] Shutdown signal received.");
            })
            .await
            .ok();
    });

    // 启动 UDP 广播发现
    let discovery_running = {
        let state = sync_state.lock().unwrap();
        state.discovery_running.clone()
    };
    discovery_running.store(true, Ordering::Relaxed);
    discovery::start_discovery(device_name, HTTP_PORT, discovery_running);

    // 生成初始 PIN
    let pin = auth_clone.generate_pin();

    Ok(SyncStatusResponse {
        running: true,
        port: HTTP_PORT,
        pin: Some(pin),
        local_ip: get_local_ip(),
    })
}

/// Tauri 命令：停止同步服务器
#[tauri::command]
pub async fn stop_sync_server(app: AppHandle) -> Result<(), String> {
    let sync_state = app.state::<Mutex<SyncServerState>>();
    let state = sync_state.lock().unwrap();
    state.running.store(false, Ordering::Relaxed);
    state.discovery_running.store(false, Ordering::Relaxed);
    eprintln!("[SyncServer] Stop requested.");
    Ok(())
}

/// Tauri 命令：获取同步服务器状态
#[tauri::command]
pub fn get_sync_status(app: AppHandle) -> SyncStatusResponse {
    let sync_state = app.state::<Mutex<SyncServerState>>();
    let state = sync_state.lock().unwrap();
    let running = state.running.load(Ordering::Relaxed);
    let pin = if running { state.auth.current_pin() } else { None };

    SyncStatusResponse {
        running,
        port: state.port,
        pin,
        local_ip: get_local_ip(),
    }
}

/// Tauri 命令：生成/刷新 PIN 码（用于配对）
#[tauri::command]
pub fn generate_sync_pin(app: AppHandle) -> Result<String, String> {
    let sync_state = app.state::<Mutex<SyncServerState>>();
    let state = sync_state.lock().unwrap();
    
    if !state.running.load(Ordering::Relaxed) {
        return Err("Sync server is not running".to_string());
    }
    
    Ok(state.auth.generate_pin())
}

/// Tauri 命令：设置自定义6位配对码
#[tauri::command]
pub fn set_sync_pin(app: AppHandle, pin: String) -> Result<String, String> {
    let sync_state = app.state::<Mutex<SyncServerState>>();
    let state = sync_state.lock().unwrap();
    
    if !state.running.load(Ordering::Relaxed) {
        return Err("Sync server is not running".to_string());
    }
    
    state.auth.set_pin(&pin)
}

fn get_device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Now PC".to_string())
}

fn get_local_ip() -> Option<String> {
    use std::net::UdpSocket;
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}

fn get_db_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data_dir.join("history.db"))
}
