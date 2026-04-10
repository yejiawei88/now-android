mod commands;
pub mod db;
pub mod sync;
use std::collections::HashMap;
use std::sync::Mutex;

use tauri::Manager;

macro_rules! debug_log {
    ($($arg:tt)*) => {
        #[cfg(debug_assertions)]
        eprintln!($($arg)*);
    };
}

pub struct AppState {
    pub scheduled_notifications: Mutex<HashMap<String, bool>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    
    tauri::Builder::default()
        .manage(AppState {
            scheduled_notifications: Mutex::new(HashMap::new()),
        })
        .manage(Mutex::new(sync::server::SyncServerState::new()))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 初始化数据库
            let app_data_dir = match app.path().app_data_dir() {
                Ok(dir) => {
                    debug_log!("App data dir: {:?}", dir);
                    dir
                }
                Err(e) => {
                    debug_log!("Failed to get app data dir: {:?}", e);
                    return Err(e.into());
                }
            };
            
            if let Err(e) = std::fs::create_dir_all(&app_data_dir) {
                debug_log!("Failed to create app data dir: {:?}", e);
                return Err(e.into());
            }

            // 创建图片存储目录
            let clipboard_img_dir = app_data_dir.join("clipboard_images");
            if let Err(_e) = std::fs::create_dir_all(&clipboard_img_dir) {
                debug_log!("Failed to create clipboard images dir: {:?}", _e);
            }

            let conn = match db::init_db(app_data_dir.clone()) {
                Ok(c) => {
                    debug_log!("Database initialized successfully at {:?}", app_data_dir);
                    c
                }
                Err(e) => {
                    debug_log!("Failed to init database: {:?}", e);
                    return Err(e.into());
                }
            };

            // Seed default config (First Run)
            if let Err(_e) = db::seed_config_if_needed(app.handle().clone()) {
                debug_log!("Failed to seed default config: {}", _e);
            }

            app.manage(std::sync::Mutex::new(conn));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::select_file,
            commands::select_folder,
            commands::save_file,
            commands::save_image,
            commands::read_file,
            commands::read_file_bytes,
            commands::read_folder_markdown_files,
            commands::paste_text,
            commands::write_clipboard_text,
            commands::export_markdown_files,
            commands::export_full_backup,
            commands::read_full_backup,
            commands::schedule_notification,
            commands::cancel_notification,
            commands::get_machine_id,
            commands::check_license_status,
            commands::verify_license,
            commands::unbind_license,
            commands::get_license_devices,
            db::db_load_items,
            db::db_get_item,
            db::db_get_document_entry,
            db::db_save_items,
            db::db_upsert_item,
            db::db_save_document_entry,
            db::db_delete_item,
            db::db_update_items_order,
            db::db_cleanup_old_history,
            db::db_restore_from_backup,
            db::get_default_config,
            db::db_rename_category,
            db::db_delete_items_by_category,
            db::db_seed_default_library,
            db::db_import_official_seed,
            db::validate_official_seed_package,
            db::get_official_seed_signature,
            db::db_reveal_vault,
            db::db_load_vault_items,
            db::db_query_items,
            db::db_export_to_vault,
            db::db_get_items_since,
            db::db_get_deleted_since,
            db::db_sync_items_from_remote,
            sync::server::start_sync_server,
            sync::server::stop_sync_server,
            sync::server::get_sync_status,
            sync::server::generate_sync_pin,
            sync::server::set_sync_pin,
        ])
        .run(context)
        .expect("error while running tauri application");
}
