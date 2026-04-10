use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use rusqlite::Connection;
use std::sync::Mutex;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, State};
use std::fs;

pub struct AppState {
    pub scheduled_notifications: Mutex<HashMap<String, bool>>,
}

pub(crate) mod files;
pub(crate) mod license;
pub use files::*;
pub use license::*;

// --- Clipboard Commands ---

#[tauri::command]
pub async fn paste_text(
    app: AppHandle,
    text: Option<String>,
    _should_hide: bool,
    _treat_as_image: Option<bool>,
    _restore_focus_to_main: Option<bool>,
) -> Result<(), String> {
    // Android 版：仅支持写入剪贴板，不支持模拟粘贴到其他应用
    if let Some(content) = text {
        use tauri_plugin_clipboard_manager::ClipboardExt;
        app.clipboard()
            .write_text(content)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn write_clipboard_text(text: String) -> Result<(), String> {
    // 此命令在前端通过插件调用
    Ok(())
}

// --- Notification Commands ---

#[tauri::command]
pub fn schedule_notification(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    title: String,
    body: String,
    delay_ms: u64
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    {
        let mut scheduled = state.scheduled_notifications.lock().unwrap();
        scheduled.insert(id.clone(), true);
    }

    let id_clone = id.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        
        let is_active = {
            let state = app.state::<AppState>();
            let scheduled = state.scheduled_notifications.lock().unwrap();
            scheduled.get(&id_clone).cloned().unwrap_or(false)
        };

        if is_active {
            let _ = app.notification()
                .builder()
                .title(title)
                .body(body)
                .show();
            
            let state = app.state::<AppState>();
            let mut scheduled = state.scheduled_notifications.lock().unwrap();
            scheduled.remove(&id_clone);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_notification(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut scheduled = state.scheduled_notifications.lock().unwrap();
    if let Some(active) = scheduled.get_mut(&id) {
        *active = false;
        scheduled.remove(&id);
    }
    Ok(())
}

// --- Export/Backup Commands ---

fn write_markdown_hierarchy(base_dir: &std::path::Path, groups: &std::collections::HashMap<String, Vec<serde_json::Value>>) -> Result<(), String> {
    for (cat_name, items) in groups {
        let safe_cat_name: String = cat_name.chars().map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' || c > '\x7f' { c } else { '_' }).collect();
        let cat_dir = base_dir.join(&safe_cat_name);
        std::fs::create_dir_all(&cat_dir).map_err(|e| format!("Failed to create group dir: {}", e))?;

        for item in items {
            let item_type = item["type"].as_str().unwrap_or("TEXT");
            let content = item["content"].as_str().unwrap_or("");
            let tags = item["tags"].as_array();
            
            let mut main_tag = String::new();
            if let Some(t_array) = tags {
                if !t_array.is_empty() {
                    main_tag = t_array[0].as_str().unwrap_or("").trim().to_string();
                }
            }
            if main_tag.is_empty() {
                 let fallback: String = content.chars().filter(|c| !c.is_control() && *c != '\n').take(12).collect();
                 main_tag = if fallback.is_empty() { "未命名".to_string() } else { fallback.trim().to_string() };
            }
            if main_tag.is_empty() { main_tag = "未命名".to_string(); }

            let safe_main_tag: String = main_tag.chars().map(|c| match c {
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
                c if c < '\x20' => '_',
                _ => c
            }).collect();
            let mut safe_main_tag = safe_main_tag.trim().trim_matches('.').to_string();
            if safe_main_tag.is_empty() { safe_main_tag = "未命名".to_string(); }

            if item_type == "DOCUMENT" {
                let mut doc_dir = cat_dir.join(&safe_main_tag);
                let mut counter = 1;
                while doc_dir.exists() && counter < 100 {
                    doc_dir = cat_dir.join(format!("{}_{}", safe_main_tag, counter));
                    counter += 1;
                }
                std::fs::create_dir_all(&doc_dir).map_err(|e| format!("Failed to create document dir: {}", e))?;

                let parsed_content: Option<std::collections::HashMap<String, String>> = serde_json::from_str(content).ok();
                
                let mut output_files = Vec::new();
                if let Some(t_array) = tags {
                    for t in t_array {
                       if let Some(tag_name) = t.as_str() {
                           let tag_content = if let Some(ref m) = parsed_content {
                               m.get(tag_name).cloned().unwrap_or_else(|| String::new())
                           } else {
                               if tag_name == main_tag { content.to_string() } else { String::new() }
                           };
                           output_files.push((tag_name, tag_content));
                       }
                    }
                } else {
                    output_files.push((&safe_main_tag, content.to_string()));
                }

                for (tag_name, tag_content) in output_files {
                    let safe_tag: String = tag_name.chars().map(|c| match c {
                        '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
                        c if c < '\x20' => '_',
                        _ => c
                    }).collect();
                    let mut safe_tag_name = safe_tag.trim().trim_matches('.').to_string();
                    if safe_tag_name.is_empty() { safe_tag_name = "未命名".to_string(); }

                    let mut file_path = doc_dir.join(format!("{}.md", safe_tag_name));
                    let mut f_counter = 1;
                    while file_path.exists() && f_counter < 50 {
                        file_path = doc_dir.join(format!("{}_{}.md", safe_tag_name, f_counter));
                        f_counter += 1;
                    }
                    std::fs::write(file_path, tag_content).unwrap_or_default();
                }
            } else {
                let mut file_path = cat_dir.join(format!("{}.md", safe_main_tag));
                let mut counter = 1;
                while file_path.exists() && counter < 100 {
                     file_path = cat_dir.join(format!("{}_{}.md", safe_main_tag, counter));
                     counter += 1;
                }
                std::fs::write(file_path, content).unwrap_or_default();
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn export_markdown_files(
    conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    base_path: String,
    library_id: String,
    library_name: String,
) -> Result<(), String> {
    let items_groups = {
        let conn = conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, content, title, body, item_type, timestamp, category, tags FROM clipboard_history WHERE library_id = ?1").map_err(|e: rusqlite::Error| e.to_string())?;
        
        let item_iter = stmt.query_map([library_id], |row: &rusqlite::Row| {
            let tags_str: String = row.get(7)?;
            let tags: serde_json::Value = serde_json::from_str(&tags_str).unwrap_or(serde_json::Value::Null);
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "content": row.get::<_, String>(1)?,
                "title": row.get::<_, Option<String>>(2)?,
                "body": row.get::<_, Option<String>>(3)?,
                "type": row.get::<_, String>(4)?,
                "timestamp": row.get::<_, i64>(5)?,
                "category": row.get::<_, Option<String>>(6)?,
                "tags": tags
            }))
        }).map_err(|e: rusqlite::Error| e.to_string())?;

        let mut groups: std::collections::HashMap<String, Vec<serde_json::Value>> = std::collections::HashMap::new();
        for item in item_iter {
            let v: serde_json::Value = item.map_err(|e: rusqlite::Error| e.to_string())?;
            let cat_name = v["category"].as_str().unwrap_or("未分类").to_string();
            groups.entry(cat_name).or_insert_with(Vec::new).push(v);
        }
        groups
    };

    let safe_lib_name: String = library_name.chars().map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' || c > '\x7f' { c } else { '_' }).collect();
    let lib_path = std::path::Path::new(&base_path).join(&safe_lib_name);
    std::fs::create_dir_all(&lib_path).map_err(|e| e.to_string())?;

    write_markdown_hierarchy(&lib_path, &items_groups)?;
    
    Ok(())
}

#[derive(Deserialize)]
pub struct SimpleLibInfo {
    pub id: String,
    pub name: String,
}

#[tauri::command]
pub async fn export_full_backup(
    conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    base_path: String,
    folder_name: String,
    app_config_json: String,
    libraries: Vec<SimpleLibInfo>
) -> Result<(), String> {
    let root = std::path::Path::new(&base_path).join(folder_name);
    
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    std::fs::write(root.join("app_config.json"), app_config_json).map_err(|e| e.to_string())?;

    let libs_root = root.join("clipboard_data");
    std::fs::create_dir_all(&libs_root).map_err(|e| e.to_string())?;

    for lib in libraries {
        let (full_json, groups) = {
            let conn = conn.lock().unwrap();
            let mut stmt = conn.prepare("SELECT id, content, title, body, item_type, is_pinned, timestamp, category, tags FROM clipboard_history WHERE library_id = ?1").map_err(|e: rusqlite::Error| e.to_string())?;
            let item_iter = stmt.query_map([&lib.id], |row: &rusqlite::Row| {
                let tags_str: String = row.get(8)?;
                let tags: serde_json::Value = serde_json::from_str(&tags_str).unwrap_or(serde_json::Value::Null);
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "content": row.get::<_, String>(1)?,
                    "title": row.get::<_, Option<String>>(2)?,
                    "body": row.get::<_, Option<String>>(3)?,
                    "type": row.get::<_, String>(4)?,
                    "isPinned": row.get::<_, i32>(5)? == 1,
                    "timestamp": row.get::<_, i64>(6)?,
                    "category": row.get::<_, Option<String>>(7)?,
                    "tags": tags
                }))
            }).map_err(|e: rusqlite::Error| e.to_string())?;

            let mut items = Vec::new();
            let mut groups: std::collections::HashMap<String, Vec<serde_json::Value>> = std::collections::HashMap::new();
            for item in item_iter {
                let v: serde_json::Value = item.map_err(|e: rusqlite::Error| e.to_string())?;
                let cat_name = v["category"].as_str().unwrap_or("未分类").to_string();
                groups.entry(cat_name).or_insert_with(Vec::new).push(v.clone());
                items.push(v);
            }
            (serde_json::to_string(&items).unwrap_or_else(|_| "[]".to_string()), groups)
        };

        let safe_lib_name: String = lib.name.chars().map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' || c > '\x7f' { c } else { '_' }).collect();
        let lib_dir = libs_root.join(&safe_lib_name);
        std::fs::create_dir_all(&lib_dir).map_err(|e| e.to_string())?;

        std::fs::write(lib_dir.join("full_data.json"), full_json).map_err(|e| e.to_string())?;

        let metadata = serde_json::json!({ "original_name": lib.name });
        std::fs::write(lib_dir.join("metadata.json"), metadata.to_string()).map_err(|e| e.to_string())?;

        let md_dir = lib_dir.join("readable_markdown");
        std::fs::create_dir_all(&md_dir).map_err(|e| e.to_string())?;

        write_markdown_hierarchy(&md_dir, &groups)?;
    }

    Ok(())
}

#[derive(Serialize)]
pub struct FullBackupResponse {
    pub app_config_json: String,
    pub libraries: Vec<FullBackupLibraryResponse>,
}

#[derive(Serialize)]
pub struct FullBackupLibraryResponse {
    pub name: String,
    pub full_json: String,
}

#[tauri::command]
pub async fn read_full_backup(folder_path: String) -> Result<String, String> {
    let mut root = std::path::PathBuf::from(&folder_path);
    
    let direct_config = root.join("app_config.json");
    if !direct_config.exists() {
        if let Ok(entries) = std::fs::read_dir(&root) {
            let mut found_sub = None;
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let sub_app_config = entry.path().join("app_config.json");
                    if sub_app_config.exists() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.starts_with("Now_Backup_") {
                            found_sub = Some(entry.path());
                            break;
                        }
                        if found_sub.is_none() {
                            found_sub = Some(entry.path());
                        }
                    }
                }
            }
            if let Some(sub) = found_sub {
                root = sub;
            }
        }
    }

    let app_config_path = root.join("app_config.json");
    let app_config = std::fs::read_to_string(&app_config_path)
        .map_err(|e| format!("Failed to find app_config.json.\nSearch path: {:?}\nError: {}", app_config_path, e))?;

    let mut libraries = Vec::new();
    let libs_root = root.join("clipboard_data");
    if libs_root.exists() {
        if let Ok(entries) = std::fs::read_dir(libs_root) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let lib_name = entry.file_name().to_string_lossy().to_string();
                    let json_path = entry.path().join("full_data.json");
                    
                    let metadata_path = entry.path().join("metadata.json");
                    let original_name = if metadata_path.exists() {
                        std::fs::read_to_string(&metadata_path)
                            .ok()
                            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                            .and_then(|v| v["original_name"].as_str().map(|s| s.to_string()))
                            .unwrap_or_else(|| lib_name.clone())
                    } else {
                        lib_name.clone()
                    };
                    
                    if let Ok(json_content) = std::fs::read_to_string(json_path) {
                        libraries.push(FullBackupLibraryResponse {
                            name: original_name,
                            full_json: json_content,
                        });
                    }
                }
            }
        }
    }

    let resp = FullBackupResponse {
        app_config_json: app_config,
        libraries,
    };

    serde_json::to_string(&resp).map_err(|e| e.to_string())
}
