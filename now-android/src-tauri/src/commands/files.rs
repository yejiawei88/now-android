use tauri::{AppHandle, Runtime};
use std::fs;
use std::path::Path;

#[derive(serde::Serialize)]
pub struct ReadFileBytesResponse {
    pub path: String,
    pub bytes: Vec<u8>,
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn select_file<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_file(move |file_path: Option<tauri_plugin_dialog::PathBuf>| {
        let path = file_path.map(|p| p.to_string());
        let _ = tx.send(path);
    });
    rx.recv().map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn select_file<R: Runtime>(_app: AppHandle<R>) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn select_folder<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |folder_path: Option<tauri_plugin_dialog::PathBuf>| {
        let path = folder_path.map(|p| p.to_string());
        let _ = tx.send(path);
    });
    rx.recv().map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn select_folder<R: Runtime>(_app: AppHandle<R>) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn save_file<R: Runtime>(app: AppHandle<R>, content: String, filename: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().set_file_name(filename).save_file(move |file_path: Option<tauri_plugin_dialog::PathBuf>| {
        let res = if let Some(path) = file_path {
            std::fs::write(path.to_string(), content).is_ok()
        } else {
            false
        };
        let _ = tx.send(res);
    });
    rx.recv().map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn save_file<R: Runtime>(_app: AppHandle<R>, _content: String, _filename: String) -> Result<bool, String> {
    Ok(false)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn read_file<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_file(move |file_path: Option<tauri_plugin_dialog::PathBuf>| {
        let content = if let Some(path) = file_path {
            std::fs::read_to_string(path.to_string()).ok()
        } else {
            None
        };
        let _ = tx.send(content);
    });
    rx.recv().map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn read_file<R: Runtime>(_app: AppHandle<R>) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn read_file_bytes<R: Runtime>(app: AppHandle<R>) -> Result<Option<ReadFileBytesResponse>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_file(move |file_path: Option<tauri_plugin_dialog::PathBuf>| {
        let content = if let Some(path) = file_path {
            let path_str = path.to_string();
            std::fs::read(&path_str).ok().map(|bytes| ReadFileBytesResponse {
                path: path_str,
                bytes,
            })
        } else {
            None
        };
        let _ = tx.send(content);
    });
    rx.recv().map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn read_file_bytes<R: Runtime>(_app: AppHandle<R>) -> Result<Option<ReadFileBytesResponse>, String> {
    Ok(None)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn read_folder_markdown_files<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    
    app.dialog().file().pick_folder(move |folder_path: Option<tauri_plugin_dialog::PathBuf>| {
        let content = if let Some(path) = folder_path {
            let folder_str = path.to_string();
            read_all_md_files(&folder_str).ok()
        } else {
            None
        };
        let _ = tx.send(content);
    });
    
    rx.recv().map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn read_folder_markdown_files<R: Runtime>(_app: AppHandle<R>) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(target_os = "android"))]
fn read_all_md_files(folder_path: &str) -> Result<String, String> {
    let folder = Path::new(folder_path);
    if !folder.exists() || !folder.is_dir() {
        return Err("路径不存在或不是文件夹".to_string());
    }
    
    let mut md_files = Vec::new();
    
    fn collect_md_files(dir: &Path, files: &mut Vec<(String, String)>) -> Result<(), String> {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    collect_md_files(&path, files)?;
                } else if path.extension().and_then(|s| s.to_str()) == Some("md") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        let filename = path.file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("默认")
                            .to_string();
                        files.push((filename, content));
                    }
                }
            }
        }
        Ok(())
    }
    
    collect_md_files(folder, &mut md_files)?;
    
    if md_files.is_empty() {
        return Err("未找到任何 Markdown 文件".to_string());
    }
    
    let json_array: Vec<serde_json::Value> = md_files.into_iter().map(|(filename, content)| {
        serde_json::json!({
            "filename": filename,
            "content": content
        })
    }).collect();
    
    let json_str = serde_json::to_string(&json_array).map_err(|e| e.to_string())?;
    Ok(json_str)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn save_image<R: Runtime>(app: AppHandle<R>, base64_data: String, filename: Option<String>) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    use base64::{Engine as _, engine::general_purpose};

    let clean_data = if let Some(index) = base64_data.find(',') {
        &base64_data[index + 1..]
    } else {
        &base64_data
    };
    
    let clean_data = clean_data.trim();

    let image_bytes = match general_purpose::STANDARD.decode(clean_data) {
        Ok(b) => b,
        Err(e) => return Err(format!("Base64 decode failed: {}", e)),
    };

    let default_name = filename.unwrap_or_else(|| "image.png".to_string());
    
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().set_file_name(default_name).save_file(move |file_path: Option<tauri_plugin_dialog::PathBuf>| {
        let res = if let Some(path) = file_path {
            std::fs::write(path.to_string(), image_bytes).is_ok()
        } else {
            false
        };
        let _ = tx.send(res);
    });
    rx.recv().map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn save_image<R: Runtime>(_app: AppHandle<R>, _base64_data: String, _filename: Option<String>) -> Result<bool, String> {
    Ok(false)
}
