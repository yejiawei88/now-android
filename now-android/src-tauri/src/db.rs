use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Result};
use serde_json;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use tauri::AppHandle;

macro_rules! debug_log {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!($($arg)*);
        }
    };
}

use tauri::Manager;

pub fn safe_filename(name: &str) -> String {
    // Remove emojis like 📂 at the start
    let name = if name.starts_with('\u{1F4C1}') || name.starts_with('\u{1F4C2}') {
        name[4..].trim()
    } else if name.starts_with('📂') {
        // Some systems might represent it differently, but usually it's a 4-byte char
        let mut chars = name.chars();
        chars.next();
        chars.as_str().trim()
    } else {
        name
    };

    let s: String = name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == ' ' || *c == '.' || *c == '(' || *c == ')' || *c == '!' || *c == '@' || *c == '#' || *c == '$' || *c == '&')
        .collect();
    let s = s.trim().to_string();
    if s.is_empty() { "Untitled".to_string() } else { s }
}

pub fn resolve_parent_path(conn: &Connection, tags_json: &str) -> Vec<String> {
    let mut path = Vec::new();
    let tags: serde_json::Value = serde_json::from_str(tags_json).unwrap_or(serde_json::Value::Null);
    
    let mut current_tags = tags;
    for _ in 0..10 { // Max depth 10
        let mut found_parent_id = None;
        if let Some(arr) = current_tags.as_array() {
            for t in arr {
                if let Some(s) = t.as_str() {
                    if s.starts_with("__p:") {
                        found_parent_id = Some(s[4..].to_string());
                        break;
                    }
                }
            }
        }

        if let Some(pid) = found_parent_id {
            let parent_data: Option<String> = conn.query_row(
                "SELECT tags FROM clipboard_history WHERE id = ?1",
                params![pid],
                |row| row.get(0)
            ).ok();

            if let Some(pt_json) = parent_data {
                let pt_tags: serde_json::Value = serde_json::from_str(&pt_json).unwrap_or(serde_json::Value::Null);
                if let Some(pt_arr) = pt_tags.as_array() {
                    if let Some(title) = pt_arr.get(0).and_then(|v| v.as_str()) {
                        path.push(title.to_string());
                        current_tags = pt_tags;
                        continue;
                    }
                }
            }
        }
        break;
    }
    path.reverse();
    path
}

pub fn get_vault_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir()
        .map(|p| p.join("Vault"))
        .map_err(|e| e.to_string())
}

fn candidate_resource_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir.clone());
        roots.push(resource_dir.join("resources"));
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            roots.push(exe_dir.to_path_buf());
            roots.push(exe_dir.join("resources"));

            if let Some(parent_dir) = exe_dir.parent() {
                roots.push(parent_dir.to_path_buf());
                roots.push(parent_dir.join("resources"));
            }
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        roots.push(current_dir.clone());
        roots.push(current_dir.join("resources"));
        roots.push(current_dir.join("src-tauri").join("resources"));
    }

    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"));

    let mut unique_roots = Vec::new();
    for root in roots {
        if !unique_roots.iter().any(|existing| existing == &root) {
            unique_roots.push(root);
        }
    }

    unique_roots
}

fn resolve_resource_file(app: &AppHandle, name: &str) -> Option<PathBuf> {
    for root in candidate_resource_roots(app) {
        let path = root.join(name);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

fn get_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("history.db"))
        .map_err(|e| e.to_string())
}

fn open_read_db(app: &AppHandle) -> Result<Connection, String> {
    Connection::open_with_flags(
        get_db_path(app)?,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| e.to_string())
}

fn parse_tags(tags_json: &str) -> Vec<String> {
    serde_json::from_str::<serde_json::Value>(tags_json)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .map(|tags| {
            tags.into_iter()
                .filter_map(|tag| tag.as_str().map(|value| value.trim().to_string()))
                .filter(|tag| !tag.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn split_seed_tag_candidates(raw: &str) -> Vec<String> {
    raw.split(|ch: char| matches!(ch, ',' | '，' | '、' | ';' | '；' | '|' | '\n' | '\r' | '\t'))
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
        .map(|part| part.to_string())
        .collect()
}

fn normalize_seed_tags_for_import(tags: Vec<String>, content: &str) -> Vec<String> {
    let mut expanded: Vec<String> = Vec::new();

    if tags.is_empty() {
        expanded.extend(split_seed_tag_candidates(content));
    } else {
        for (index, tag) in tags.into_iter().enumerate() {
            let normalized = tag.trim().to_string();
            if normalized.is_empty() {
                continue;
            }
            if normalized.starts_with("__p:") || normalized.starts_with("__status_") {
                expanded.push(normalized);
                continue;
            }
            if index == 0 {
                expanded.push(normalized);
                continue;
            }

            let split_parts = split_seed_tag_candidates(&normalized);
            if split_parts.len() > 1 {
                expanded.extend(split_parts);
            } else {
                expanded.push(normalized);
            }
        }
    }

    let mut deduped: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    for tag in expanded {
        let key = tag.to_lowercase();
        if seen.insert(key) {
            deduped.push(tag);
        }
    }
    deduped
}

fn rebuild_seed_tags_content(tags: &[String], fallback_content: &str) -> String {
    let visible_tags: Vec<&str> = tags
        .iter()
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty() && !tag.starts_with("__p:") && !tag.starts_with("__status_"))
        .collect();

    if visible_tags.is_empty() {
        return fallback_content.to_string();
    }

    if visible_tags.len() == 1 {
        return visible_tags[0].to_string();
    }

    format!("{}, {}", visible_tags[0], visible_tags[1..].join(", "))
}

fn get_parent_id_from_tags(tags_json: &str) -> Option<String> {
    parse_tags(tags_json)
        .into_iter()
        .find_map(|tag| tag.strip_prefix("__p:").map(|value| value.trim().to_string()))
        .filter(|value| !value.is_empty())
}

fn is_folder_tag(tag: &str) -> bool {
    tag.starts_with('\u{1F4C1}') || tag.starts_with("馃搨")
}

fn get_visible_document_tags(tags_json: &str) -> Vec<String> {
    parse_tags(tags_json)
        .into_iter()
        .filter(|tag| !tag.starts_with("__status_") && !tag.starts_with("__p:") && !is_folder_tag(tag))
        .collect()
}

fn get_document_fallback_tag(tags_json: &str) -> Option<String> {
    get_visible_document_tags(tags_json).last().cloned()
}

fn extract_document_entries_from_content(
    content: &str,
    tags_json: &str,
) -> Vec<(String, String, Option<String>)> {
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(content) {
        if let Some(map) = parsed.as_object() {
            let mut entries = Vec::new();
            for (tag_name, value) in map {
                if tag_name.starts_with("__status_") {
                    continue;
                }

                let tag_content = value
                    .as_str()
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| value.to_string());
                let status = map.get(&format!("__status_{}", tag_name)).and_then(|status_value| {
                    status_value
                        .as_str()
                        .map(ToOwned::to_owned)
                        .or_else(|| Some(status_value.to_string()))
                });

                entries.push((tag_name.clone(), tag_content, status));
            }
            return entries;
        }
    }

    let trimmed = content.trim();
    if trimmed.is_empty() || trimmed == "{}" {
        return Vec::new();
    }

    get_document_fallback_tag(tags_json)
        .map(|tag_name| vec![(tag_name, content.to_string(), None)])
        .unwrap_or_default()
}

fn normalize_document_content_json(content: &str, tags_json: &str) -> Result<String, String> {
    let mut content_map = serde_json::Map::new();

    for (tag_name, tag_content, status) in extract_document_entries_from_content(content, tags_json) {
        content_map.insert(tag_name.clone(), serde_json::Value::String(tag_content));
        if let Some(status) = status {
            content_map.insert(
                format!("__status_{}", tag_name),
                serde_json::Value::String(status),
            );
        }
    }

    serde_json::to_string(&serde_json::Value::Object(content_map)).map_err(|e| e.to_string())
}

fn build_document_entries_fts_query(search: &str) -> Option<String> {
    let has_cjk = search.chars().any(|c| matches!(c as u32,
        0x3400..=0x4DBF |
        0x4E00..=0x9FFF |
        0xF900..=0xFAFF |
        0x20000..=0x2A6DF |
        0x2A700..=0x2B73F |
        0x2B740..=0x2B81F |
        0x2B820..=0x2CEAF
    ));

    let raw_terms = if has_cjk && !search.contains(char::is_whitespace) {
        search
            .chars()
            .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation())
            .map(|c| c.to_string())
            .collect::<Vec<_>>()
    } else {
        search
            .split_whitespace()
            .map(|term| term.to_string())
            .collect::<Vec<_>>()
    };

    let terms = raw_terms
        .into_iter()
        .map(|term| term.trim_matches(|c: char| c.is_whitespace() || c == '"' || c == '\'').to_string())
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>();

    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" AND "))
    }
}

fn build_document_entries_exact_phrase_query(search: &str) -> Option<String> {
    let trimmed = search.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(format!("\"{}\"", trimmed.replace('"', "\"\"")))
    }
}

fn escape_like_pattern(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn delete_document_entries_fts_for_item(conn: &Connection, item_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM document_entries_fts WHERE item_id = ?1",
        params![item_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn delete_document_entry_fts(conn: &Connection, item_id: &str, tag_name: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM document_entries_fts WHERE item_id = ?1 AND tag_name = ?2",
        params![item_id, tag_name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn upsert_document_entry_fts(
    conn: &Connection,
    item_id: &str,
    tag_name: &str,
    content: &str,
) -> Result<(), String> {
    delete_document_entry_fts(conn, item_id, tag_name)?;
    conn.execute(
        "INSERT INTO document_entries_fts (item_id, tag_name, content) VALUES (?1, ?2, ?3)",
        params![item_id, tag_name, content],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn rebuild_document_entries_fts(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM document_entries_fts", [])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO document_entries_fts (item_id, tag_name, content)
         SELECT item_id, tag_name, content FROM document_entries",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn load_document_entry_maps(
    conn: &Connection,
    item_ids: &[String],
) -> Result<HashMap<String, HashMap<String, String>>, String> {
    if item_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders = std::iter::repeat("?")
        .take(item_ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT item_id, tag_name, content, status FROM document_entries WHERE item_id IN ({}) ORDER BY item_id, tag_name",
        placeholders
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(item_ids.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut maps_by_item = HashMap::new();
    for row in rows {
        let (item_id, tag_name, content, status) = row.map_err(|e| e.to_string())?;
        let entry_map = maps_by_item
            .entry(item_id)
            .or_insert_with(HashMap::<String, String>::new);
        entry_map.insert(tag_name.clone(), content);
        if let Some(status) = status {
            entry_map.insert(format!("__status_{}", tag_name), status);
        }
    }

    Ok(maps_by_item)
}

fn materialize_document_content_by_id(
    conn: &Connection,
    doc_rows: &[(String, String, String)],
) -> Result<HashMap<String, String>, String> {
    let ids = doc_rows
        .iter()
        .map(|(id, _, _)| id.clone())
        .collect::<Vec<_>>();
    let stored_maps = load_document_entry_maps(conn, &ids)?;
    let mut materialized = HashMap::new();

    for (id, raw_content, tags_json) in doc_rows {
        if let Some(entry_map) = stored_maps.get(id) {
            let value = serde_json::to_string(entry_map).map_err(|e| e.to_string())?;
            materialized.insert(id.clone(), value);
            continue;
        }

        materialized.insert(id.clone(), normalize_document_content_json(raw_content, tags_json)?);
    }

    Ok(materialized)
}

fn sync_document_entries(
    conn: &Connection,
    item_id: &str,
    tags_json: &str,
    content: &str,
) -> Result<(), String> {
    let valid_tags = get_visible_document_tags(tags_json)
        .into_iter()
        .collect::<HashSet<_>>();
    let parsed_entries = extract_document_entries_from_content(content, tags_json);
    let target_entries = parsed_entries
        .into_iter()
        .filter(|(tag_name, _, _)| valid_tags.contains(tag_name))
        .fold(
            HashMap::<String, (String, Option<String>)>::new(),
            |mut acc, (tag_name, tag_content, status)| {
                acc.insert(tag_name, (tag_content, status));
                acc
            },
        );

    let existing_tags = {
        let mut stmt = conn
            .prepare("SELECT tag_name FROM document_entries WHERE item_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![item_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut tags = Vec::new();
        for row in rows {
            tags.push(row.map_err(|e| e.to_string())?);
        }
        tags
    };

    {
        let mut delete_stmt = conn
            .prepare("DELETE FROM document_entries WHERE item_id = ?1 AND tag_name = ?2")
            .map_err(|e| e.to_string())?;

        for existing_tag in existing_tags {
            if !valid_tags.contains(&existing_tag) || !target_entries.contains_key(&existing_tag) {
                delete_document_entry_fts(conn, item_id, &existing_tag)?;
                delete_stmt
                    .execute(params![item_id, existing_tag])
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    {
        let mut upsert_stmt = conn
            .prepare(
                "INSERT INTO document_entries (item_id, tag_name, content, status)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(item_id, tag_name) DO UPDATE SET
                    content = excluded.content,
                    status = excluded.status",
            )
            .map_err(|e| e.to_string())?;

        for (tag_name, (tag_content, status)) in target_entries {
            upsert_stmt
                .execute(params![item_id, &tag_name, &tag_content, status])
                .map_err(|e| e.to_string())?;
            upsert_document_entry_fts(conn, item_id, &tag_name, &tag_content)?;
        }
    }

    Ok(())
}

pub fn save_document_to_vault(
    vault_dir: &std::path::Path,
    _id: Option<&str>,
    library_id: &str,
    category: &str,
    tags_json: &str,
    content: &str,
    parent_path: Vec<String>,
    old_path_info: Option<(String, String, Vec<String>)> // (old_category, old_tags_json, old_parent_path)
) -> Result<(), String> {
    let tags: serde_json::Value = serde_json::from_str(tags_json).unwrap_or(serde_json::Value::Null);
    let title = if let Some(arr) = tags.as_array() {
        if !arr.is_empty() { arr[0].as_str().unwrap_or("未命名文档") } else { "未命名文档" }
    } else { "未命名文档" };

    // vault_dir already provided
    let safe_cat = safe_filename(category);
    let safe_title = safe_filename(title);
    
    let mut base_dir = vault_dir.join(library_id).join(&safe_cat);
    for p in parent_path {
        let safe_p = safe_filename(&p);
        let potential_file = base_dir.join(format!("{}.md", safe_p));
        let next_dir = base_dir.join(&safe_p);
        
        if potential_file.is_file() {
             let _ = std::fs::create_dir_all(&next_dir);
             let _ = std::fs::rename(&potential_file, next_dir.join(format!("{}.md", safe_p)));
        }
        
        base_dir = next_dir;
    }

    let parsed_content: std::collections::HashMap<String, String> = serde_json::from_str(content).unwrap_or_else(|_| {
        let mut map = std::collections::HashMap::new();
        map.insert(title.to_string(), content.to_string());
        map
    });
    let parsed_content: std::collections::HashMap<String, String> = parsed_content
        .into_iter()
        .filter(|(tag_name, _)| !tag_name.starts_with("__status_"))
        .collect();

    let has_children = false;

    let mut is_folder = has_children || parsed_content.len() > 1 || title.starts_with('📂');
    
    // If we are renaming an item, check if the old item was already a folder on disk
    if let Some((old_cat, old_tags_json, old_parent_path)) = &old_path_info {
        let old_tags: serde_json::Value = serde_json::from_str(old_tags_json).unwrap_or(serde_json::Value::Null);
        let old_title = if let Some(arr) = old_tags.as_array() {
            if !arr.is_empty() { arr[0].as_str().unwrap_or("未命名文档") } else { "未命名文档" }
        } else { "未命名文档" };
        
        let safe_old_cat = safe_filename(old_cat);
        let safe_old_title = safe_filename(old_title);
        let mut old_base = vault_dir.join(library_id).join(&safe_old_cat);
        for p in old_parent_path {
            old_base = old_base.join(safe_filename(p));
        }
        
        if old_base.join(&safe_old_title).is_dir() {
            is_folder = true;
        }
    }

    let target_path = if is_folder { base_dir.join(&safe_title) } else { base_dir.join(format!("{}.md", safe_title)) };
    
    // 1. Rename logic
    if let Some((old_cat, old_tags_json, old_parent_path)) = old_path_info {
        let old_tags: serde_json::Value = serde_json::from_str(&old_tags_json).unwrap_or(serde_json::Value::Null);
        let old_title = if let Some(arr) = old_tags.as_array() {
            if !arr.is_empty() { arr[0].as_str().unwrap_or("未命名文档") } else { "未命名文档" }
        } else { "未命名文档" };

        let safe_old_cat = safe_filename(&old_cat);
        let safe_old_title = safe_filename(&old_title);
        
        let mut old_base = vault_dir.join(library_id).join(&safe_old_cat);
        for p in old_parent_path {
            old_base = old_base.join(safe_filename(&p));
        }

        // We check for both folder and file for old path
        let folder_path = old_base.join(&safe_old_title);
        let file_path = old_base.join(format!("{}.md", safe_old_title));
        let actual_old = if folder_path.exists() { folder_path } else { file_path };
        
        if actual_old.exists() && actual_old != target_path {
            if let Some(parent) = target_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::rename(&actual_old, &target_path);
        }
    }

    // 2. Write physical files
    if is_folder {
        let _ = std::fs::create_dir_all(&target_path);
        let mut current_files = std::collections::HashSet::new();
        for (tag_name, tag_content) in &parsed_content {
            let safe_tag = safe_filename(tag_name);
            let file_path = target_path.join(format!("{}.md", safe_tag));
            let _ = std::fs::write(&file_path, tag_content);
            current_files.insert(format!("{}.md", safe_tag));
        }
        
        // Cleanup old files in folder
        if let Ok(entries) = std::fs::read_dir(&target_path) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    let fname = entry.file_name().to_string_lossy().to_string();
                    if file_type.is_file() && fname.ends_with(".md") && !current_files.contains(&fname) {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }
    } else if let Some(tag_content) = parsed_content.values().next() {
        if let Some(parent) = target_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&target_path, tag_content);
    }

    Ok(())
}

pub fn init_db(app_dir: PathBuf) -> Result<Connection> {
    let db_path = app_dir.join("history.db");
    debug_log!("Initializing database at: {:?}", db_path);
    
    // 自动备份:每次启动尝试创建一个备份文件
    if db_path.exists() {
        debug_log!("Database file exists, creating backup...");
        let bak_path = app_dir.join("history.db.bak");
        let _ = std::fs::copy(&db_path, &bak_path);
        debug_log!("Backup created at: {:?}", bak_path);
    } else {
        debug_log!("Database file does not exist, will create new one");
    }

    debug_log!("Opening database connection at {:?}", db_path);
    let mut conn = match Connection::open(&db_path) {
        Ok(c) => {
            debug_log!("Database opened successfully");
            c
        },
        Err(e) => {
            eprintln!("CRITICAL: Failed to open database: {:?}", e);
            return Err(e);
        }
    };

    // 开启 WAL 模式提高性能和稳定性
    // 注意: PRAGMA journal_mode 会返回结果,不能使用 execute()
    debug_log!("Enabling WAL mode...");
    conn.pragma_update(None, "journal_mode", "WAL")?;
    debug_log!("WAL mode enabled");

    // 初始化元数据表用于版本控制
    debug_log!("Creating metadata table...");
    conn.execute(
        "CREATE TABLE IF NOT EXISTS db_metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        )",
        [],
    )?;
    debug_log!("Metadata table created");

    // 基础表结构初始化
    debug_log!("Creating clipboard_history table...");
    conn.execute(
        "CREATE TABLE IF NOT EXISTS clipboard_history (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            title TEXT,
            body TEXT,
            item_type TEXT NOT NULL,
            is_pinned INTEGER NOT NULL DEFAULT 0,
            timestamp INTEGER NOT NULL,
            category TEXT,
            tags TEXT,
            parent_id TEXT,
            library_id TEXT NOT NULL DEFAULT 'default'
        )",
        [],
    )?;
    debug_log!("clipboard_history table created");

    // 同步删除日志表（记录已删除的 ID，用于增量同步传播删除）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sync_deleted_log (
            id         TEXT PRIMARY KEY,
            library_id TEXT NOT NULL DEFAULT '',
            deleted_at INTEGER NOT NULL
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sync_deleted_at ON sync_deleted_log (deleted_at)",
        [],
    )?;
    debug_log!("sync_deleted_log table created");

    conn.execute(
        "CREATE TABLE IF NOT EXISTS document_entries (
            item_id TEXT NOT NULL,
            tag_name TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            status TEXT,
            PRIMARY KEY (item_id, tag_name)
        )",
        [],
    )?;
    debug_log!("document_entries table created");
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS document_entries_fts USING fts5(
            item_id UNINDEXED,
            tag_name UNINDEXED,
            content,
            tokenize = 'unicode61 remove_diacritics 2'
        )",
        [],
    )?;
    debug_log!("document_entries_fts table created");

    // 执行迁移逻辑
    debug_log!("Running database migrations...");
    migrate_db(&mut conn, &app_dir)?;
    debug_log!("Migrations completed");

    // 为快速查询添加索引
    debug_log!("Creating indexes...");
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_library_category ON clipboard_history (library_id, category)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_library_category_type_timestamp ON clipboard_history (library_id, category, item_type, timestamp DESC)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_library_timestamp ON clipboard_history (library_id, timestamp DESC)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_library_parent_timestamp ON clipboard_history (library_id, parent_id, timestamp DESC)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_document_entries_item ON document_entries (item_id)",
        [],
    )?;
    debug_log!("Indexes created");

    // 4. 清理由于意外崩溃导致的幽灵图片
    let _ = cleanup_orphaned_images(app_dir.clone(), &conn);

    debug_log!("Database initialization completed successfully");

    Ok(conn)
}

/// 清理数据库中没有记录的图片文件
pub fn cleanup_orphaned_images(app_dir: PathBuf, conn: &Connection) -> Result<(), String> {
    let img_dir = app_dir.join("clipboard_images");
    if !img_dir.exists() { return Ok(()); }

    // 获取数据库中记录的所有文件路径
    let mut stmt = conn.prepare("SELECT content FROM clipboard_history WHERE item_type = 'IMAGE'").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
    
    let mut db_paths = HashSet::new();
    for row in rows {
        if let Ok(path) = row {
            db_paths.insert(path);
        }
    }

    // 遍历文件夹检查
    if let Ok(entries) = std::fs::read_dir(img_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let path_str = path.to_string_lossy().to_string();
                // 如果数据库里没这个路径，说明是僵尸文件，删掉
                if !db_paths.contains(&path_str) {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
    }
    Ok(())
}

fn migrate_db(conn: &mut Connection, app_dir: &std::path::Path) -> Result<()> {
    debug_log!("Starting database migration...");
    
    // 1. 处理旧版本(遗留的 ad-hoc 迁移)
    debug_log!("Checking table schema...");
    let table_info: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(clipboard_history)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    debug_log!("Table columns: {:?}", table_info);

    if table_info.contains(&"type".to_string()) && !table_info.contains(&"item_type".to_string()) {
        debug_log!("Migrating 'type' column to 'item_type'...");
        conn.execute("ALTER TABLE clipboard_history RENAME COLUMN type TO item_type", [])?;
        debug_log!("Column migration completed");
    }

    // 2. 版本化迁移
    debug_log!("Checking database version...");
    let mut current_version: i32 = conn.query_row(
        "SELECT value FROM db_metadata WHERE key = 'version'",
        [],
        |row| row.get::<_, String>(0).map(|s| s.parse().unwrap_or(0)),
    ).unwrap_or(1); // 默认认为是版本 1
    debug_log!("Current database version: {}", current_version);

    if current_version < 2 {
        debug_log!("Migrating DB Version 1 to 2: Extracting Vault documents...");
        
        let vault_dir = app_dir.join("Vault");
        let mut stmt = conn.prepare("SELECT id, content, category, tags, library_id FROM clipboard_history WHERE item_type = 'DOCUMENT'")?;
        
        struct DocToMigrate {
            id: String, content: String, category: Option<String>, tags_json: String, library_id: String
        }
        
        let rows = stmt.query_map([], |row| {
            Ok(DocToMigrate {
                id: row.get(0)?,
                content: row.get(1)?,
                category: row.get(2)?,
                tags_json: row.get(3)?,
                library_id: row.get(4)?,
            })
        })?;
        
        let mut docs = Vec::new();
        for row in rows {
            if let Ok(doc) = row {
                if doc.content.len() > 5 { // Only non-empty and non-"{}"
                    docs.push(doc);
                }
            }
        }
        
        for doc in docs {
            let tags: serde_json::Value = serde_json::from_str(&doc.tags_json).unwrap_or(serde_json::Value::Null);
            let title = if let Some(arr) = tags.as_array() {
                if !arr.is_empty() { arr[0].as_str().unwrap_or("未命名文档") } else { "未命名文档" }
            } else { "未命名文档" };
            
            let safe_cat = safe_filename(doc.category.as_deref().unwrap_or("Uncategorized"));
            let safe_title = safe_filename(title);
            let doc_folder = vault_dir.join(&doc.library_id).join(&safe_cat).join(&safe_title);
            
            let _ = std::fs::create_dir_all(&doc_folder);
            
            let parsed_content: std::collections::HashMap<String, String> = serde_json::from_str(&doc.content).unwrap_or_else(|_| {
                let mut map = std::collections::HashMap::new();
                map.insert(title.to_string(), doc.content.to_string());
                map
            });
            
            for (tag_name, tag_content) in &parsed_content {
                let file_path = doc_folder.join(format!("{}.md", safe_filename(tag_name)));
                let _ = std::fs::write(&file_path, tag_content);
            }
            
            conn.execute("UPDATE clipboard_history SET content = '{}' WHERE id = ?1", params![doc.id])?;
        }
        
        // Update version to 2
        conn.execute(
            "INSERT OR REPLACE INTO db_metadata (key, value) VALUES ('version', '2')",
            [],
        )?;
        debug_log!("Database version updated to 2");
        current_version = 2;
    }

    if current_version < 3 {
        debug_log!("Migrating DB Version 2 to 3: Extracting document entries...");

        let docs_to_split = {
            let mut stmt = conn.prepare(
                "SELECT id, content, tags FROM clipboard_history WHERE item_type = 'DOCUMENT'"
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?;

            let mut docs = Vec::new();
            for row in rows {
                docs.push(row?);
            }
            docs
        };

        for (item_id, content, tags_json) in docs_to_split {
            sync_document_entries(conn, &item_id, &tags_json, &content)
                .map_err(rusqlite::Error::InvalidParameterName)?;

            if content.trim() != "{}" {
                conn.execute(
                    "UPDATE clipboard_history SET content = '{}' WHERE id = ?1",
                    params![item_id],
                )?;
            }
        }

        conn.execute(
            "INSERT OR REPLACE INTO db_metadata (key, value) VALUES ('version', '3')",
            [],
        )?;
        debug_log!("Database version updated to 3");
        current_version = 3;
    }

    if !table_info.contains(&"parent_id".to_string()) {
        debug_log!("Adding parent_id column to clipboard_history...");
        conn.execute("ALTER TABLE clipboard_history ADD COLUMN parent_id TEXT", [])?;
    }
    if !table_info.contains(&"title".to_string()) {
        debug_log!("Adding title column to clipboard_history...");
        conn.execute("ALTER TABLE clipboard_history ADD COLUMN title TEXT", [])?;
    }
    if !table_info.contains(&"body".to_string()) {
        debug_log!("Adding body column to clipboard_history...");
        conn.execute("ALTER TABLE clipboard_history ADD COLUMN body TEXT", [])?;
    }

    if current_version < 4 {
        debug_log!("Migrating DB Version 3 to 4: Backfilling parent_id...");

        let rows_to_update = {
            let mut stmt = conn.prepare("SELECT id, tags FROM clipboard_history")?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            })?;

            let mut items = Vec::new();
            for row in rows {
                let (id, tags_json) = row?;
                items.push((id, tags_json.unwrap_or_default()));
            }
            items
        };

        for (id, tags_json) in rows_to_update {
            let parent_id = get_parent_id_from_tags(&tags_json);
            conn.execute(
                "UPDATE clipboard_history SET parent_id = ?1 WHERE id = ?2",
                params![parent_id, id],
            )?;
        }

        conn.execute(
            "INSERT OR REPLACE INTO db_metadata (key, value) VALUES ('version', '4')",
            [],
        )?;
        debug_log!("Database version updated to 4");
        current_version = 4;
    }

    if current_version < 5 {
        debug_log!("Migrating DB Version 4 to 5: Rebuilding document FTS...");
        rebuild_document_entries_fts(conn).map_err(rusqlite::Error::InvalidParameterName)?;
        conn.execute(
            "INSERT OR REPLACE INTO db_metadata (key, value) VALUES ('version', '5')",
            [],
        )?;
        debug_log!("Database version updated to 5");
        current_version = 5;
    }

    if current_version < 6 {
        debug_log!("Migrating DB Version 5 to 6: Backfilling structured body...");
        conn.execute(
            "UPDATE clipboard_history
             SET body = content
             WHERE item_type != 'DOCUMENT'
               AND (body IS NULL OR TRIM(body) = '')",
            [],
        )?;
        conn.execute(
            "INSERT OR REPLACE INTO db_metadata (key, value) VALUES ('version', '6')",
            [],
        )?;
        debug_log!("Database version updated to 6");
        current_version = 6;
    }

    debug_log!("No further migration needed for version {}", current_version);

    Ok(())
}

#[tauri::command]
pub fn db_save_items(
    app: tauri::AppHandle,
    conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    items_json: String,
    library_id: String,
) -> Result<(), String> {
    let items: serde_json::Value = serde_json::from_str(&items_json).map_err(|e| e.to_string())?;
    let items_array = items.as_array().ok_or("Invalid JSON array")?;

    let mut conn = conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 1. 收集当前要保存的 ID 集合，用于后续对比删除
    let mut current_ids = HashSet::new();

    // 2. 获取该库现有的所有项，用于对比删除逻辑
    let old_items: Vec<(String, String)> = {
        let mut stmt = tx.prepare("SELECT id, content FROM clipboard_history WHERE library_id = ?1").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![library_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.filter_map(Result::ok).collect()
    };

    let sql = "
        INSERT INTO clipboard_history (id, content, title, body, item_type, is_pinned, timestamp, category, tags, parent_id, library_id)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(id) DO UPDATE SET
            content = excluded.content,
            title = excluded.title,
            body = excluded.body,
            item_type = excluded.item_type,
            is_pinned = excluded.is_pinned,
            timestamp = excluded.timestamp,
            category = excluded.category,
            tags = excluded.tags,
            parent_id = excluded.parent_id,
            library_id = excluded.library_id
    ";

    {
        let mut stmt = tx.prepare(sql).map_err(|e| e.to_string())?;
        
        for item in items_array {
            let id = item["id"].as_str().unwrap_or("");
            if id.is_empty() { continue; }
            
            current_ids.insert(id.to_string());

            let mut content = item["content"].as_str().unwrap_or("").to_string();
            let item_type = item["type"].as_str().unwrap_or("TEXT");
            let is_pinned = if item["isPinned"].as_bool().unwrap_or(false) { 1 } else { 0 };
            let timestamp = item["timestamp"].as_i64().unwrap_or(0);
            let category = item["category"].as_str().unwrap_or("Uncategorized");
            let tags_json = item["tags"].to_string();
            let parent_id = get_parent_id_from_tags(&tags_json);
            let title = item.get("title").and_then(|v| v.as_str()).map(|s| s.to_string());
            let mut body = item.get("body").and_then(|v| v.as_str()).map(|s| s.to_string());

            if item_type == "DOCUMENT" {
                let parent_path = resolve_parent_path(&tx, &tags_json);
                let vault_dir = get_vault_dir(&app).map_err(|e| e.to_string())?;
                let normalized_content = normalize_document_content_json(&content, &tags_json)?;
                sync_document_entries(&tx, id, &tags_json, &normalized_content)?;
                save_document_to_vault(&vault_dir, Some(id), &library_id, category, &tags_json, &normalized_content, parent_path, None).map_err(|e| e.to_string())?;
                content = "{}".to_string();
                body = None;
            } else {
                delete_document_entries_fts_for_item(&tx, id)?;
                tx.execute("DELETE FROM document_entries WHERE item_id = ?1", params![id])
                    .map_err(|e| e.to_string())?;
                if body.as_ref().map(|v| v.trim().is_empty()).unwrap_or(true) {
                    body = Some(content.clone());
                }
            }

            stmt.execute(params![
                id, content, title, body, item_type, is_pinned, timestamp, category, tags_json, parent_id, library_id
            ]).map_err(|e| e.to_string())?;
        }
    }

    // 3. 删除该库中存在但不再 current_ids 中的旧数据
    let obsolete_items: Vec<(String, String)> = old_items.into_iter()
        .filter(|(id, _)| !current_ids.contains(id))
        .collect();

    // 执行删除并清理文件
    {
        let mut delete_stmt = tx.prepare("DELETE FROM clipboard_history WHERE id = ?1").map_err(|e| e.to_string())?;
        
        for (exist_id, content) in obsolete_items {
            if content.contains("clipboard_images") && (content.ends_with(".png") || content.ends_with(".jpg")) {
                let _ = std::fs::remove_file(std::path::Path::new(&content));
            }
            let _ = delete_document_entries_fts_for_item(&tx, &exist_id);
            let _ = tx.execute("DELETE FROM document_entries WHERE item_id = ?1", params![exist_id]);
            let _ = delete_stmt.execute(params![exist_id]);
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_load_items(
    app: tauri::AppHandle,
    _conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    library_id: String,
) -> Result<String, String> {
    let conn = open_read_db(&app)?;
    let mut stmt = conn.prepare("SELECT id, content, title, body, item_type, is_pinned, timestamp, category, tags FROM clipboard_history WHERE library_id = ?1 ORDER BY timestamp DESC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![library_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, i32>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, String>(8)?,
        ))
    }).map_err(|e| e.to_string())?;

    let mut db_rows = Vec::new();
    for row in rows {
        db_rows.push(row.map_err(|e| e.to_string())?);
    }

    let document_rows = db_rows
        .iter()
        .filter(|(_, _, _, _, item_type, _, _, _, _)| item_type == "DOCUMENT")
        .map(|(id, content, _, _, _, _, _, _, tags)| (id.clone(), content.clone(), tags.clone()))
        .collect::<Vec<_>>();
    let materialized_docs = materialize_document_content_by_id(&conn, &document_rows)?;

    let items = db_rows
        .into_iter()
        .map(|(id, content, title, body, item_type, is_pinned, timestamp, category, tags_str)| {
            let tags: serde_json::Value = serde_json::from_str(&tags_str).unwrap_or(serde_json::Value::Null);
            let final_content = if item_type == "DOCUMENT" {
                materialized_docs
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| "{}".to_string())
            } else {
                content
            };

            serde_json::json!({
                "id": id,
                "content": final_content,
                "title": title,
                "body": body,
                "type": item_type,
                "isPinned": is_pinned == 1,
                "timestamp": timestamp,
                "category": category,
                "tags": tags,
                "documentContentLoaded": true
            })
        })
        .collect::<Vec<_>>();

    serde_json::to_string(&items).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_item(
    app: tauri::AppHandle,
    _conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    id: String,
    library_id: String,
    include_document_content: Option<bool>,
) -> Result<String, String> {
    let conn = open_read_db(&app)?;
    let include_document_content = include_document_content.unwrap_or(true);
    let mut stmt = conn
        .prepare(
            "SELECT id, content, title, body, item_type, is_pinned, timestamp, category, tags
             FROM clipboard_history
             WHERE id = ?1 AND library_id = ?2
             LIMIT 1",
        )
        .map_err(|e| e.to_string())?;

    let item = stmt
        .query_row(params![id, library_id], |row| {
            let tags_str: String = row.get(8)?;
            let tags: serde_json::Value =
                serde_json::from_str(&tags_str).unwrap_or(serde_json::Value::Null);

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
        })
        .optional()
        .map_err(|e| e.to_string())?;

    let item_json = if let Some(item) = item {
        let item_id = item["id"].as_str().unwrap_or("").to_string();
        let item_type = item["type"].as_str().unwrap_or("").to_string();
        let tags_json = item["tags"].to_string();
        let raw_content = item["content"].as_str().unwrap_or("").to_string();

        let final_content = if item_type == "DOCUMENT" && include_document_content {
            materialize_document_content_by_id(&conn, &[(item_id.clone(), raw_content, tags_json)])?
                .remove(&item_id)
                .unwrap_or_else(|| "{}".to_string())
        } else {
            item["content"].as_str().unwrap_or("").to_string()
        };

        let mut patched = item;
        patched["content"] = serde_json::Value::String(final_content);
        patched["documentContentLoaded"] = serde_json::Value::Bool(item_type != "DOCUMENT" || include_document_content);
        Some(patched)
    } else {
        None
    };

    serde_json::to_string(&item_json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_document_entry(
    app: tauri::AppHandle,
    _conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    item_id: String,
    tag_name: String,
) -> Result<String, String> {
    let conn = open_read_db(&app)?;

    let entry = conn
        .query_row(
            "SELECT content, status FROM document_entries WHERE item_id = ?1 AND tag_name = ?2 LIMIT 1",
            params![item_id, tag_name],
            |row| {
                Ok(serde_json::json!({
                    "content": row.get::<_, String>(0)?,
                    "status": row.get::<_, Option<String>>(1)?,
                }))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(entry) = entry {
        return serde_json::to_string(&entry).map_err(|e| e.to_string());
    }

    let fallback = conn
        .query_row(
            "SELECT content, tags FROM clipboard_history WHERE id = ?1 AND item_type = 'DOCUMENT' LIMIT 1",
            params![item_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let fallback_entry = if let Some((raw_content, tags_json)) = fallback {
        let normalized_content = normalize_document_content_json(&raw_content, &tags_json)?;
        let parsed = serde_json::from_str::<serde_json::Value>(&normalized_content).unwrap_or(serde_json::json!({}));
        let content = parsed
            .get(&tag_name)
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        let status = parsed
            .get(&format!("__status_{}", tag_name))
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned);

        serde_json::json!({
            "content": content,
            "status": status,
        })
    } else {
        serde_json::json!({
            "content": "",
            "status": serde_json::Value::Null,
        })
    };

    serde_json::to_string(&fallback_entry).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_query_items(
    app: tauri::AppHandle,
    _conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    library_id: String,
    category: Option<String>,
    search_query: Option<String>,
    item_ids: Option<Vec<String>>,
    parent_id: Option<String>,
    root_only: bool,
    limit: i64,
    offset: i64,
    include_document_content: Option<bool>,
) -> Result<String, String> {
    let conn = open_read_db(&app)?;
    let include_document_content = include_document_content.unwrap_or(true);
    let mut has_search_ranking = false;
    
    let mut sql = String::from("SELECT id, content, title, body, item_type, is_pinned, timestamp, category, tags");
    let mut params_vec: Vec<rusqlite::types::Value> = vec![rusqlite::types::Value::Text(library_id.clone())];
    let normalized_query = search_query.as_ref().map(|q| q.trim().to_lowercase());

    if let Some(ref normalized_query) = normalized_query {
        if !normalized_query.is_empty() {
            has_search_ranking = true;
            let exact_tag_pattern = format!("%\"{}\"%", escape_like_pattern(normalized_query));
            let contains_pattern = format!("%{}%", escape_like_pattern(normalized_query));
            let title_prefix_pattern = format!("{}%", escape_like_pattern(normalized_query));
            let title_contains_pattern = format!("%{}%", escape_like_pattern(normalized_query));
            let fts_phrase_query = build_document_entries_exact_phrase_query(normalized_query);
            let fts_query = build_document_entries_fts_query(normalized_query);

            sql.push_str(", (");

            let title_exact_idx = params_vec.len() + 1;
            params_vec.push(rusqlite::types::Value::Text(normalized_query.clone()));
            sql.push_str(&format!(
                "CASE WHEN LOWER(COALESCE(json_extract(tags, '$[0]'), '')) = ?{} THEN 1000 ELSE 0 END",
                title_exact_idx
            ));

            let title_prefix_idx = params_vec.len() + 1;
            params_vec.push(rusqlite::types::Value::Text(title_prefix_pattern));
            sql.push_str(&format!(
                " + CASE WHEN LOWER(COALESCE(json_extract(tags, '$[0]'), '')) LIKE ?{} ESCAPE '\\' THEN 700 ELSE 0 END",
                title_prefix_idx
            ));

            let title_contains_idx = params_vec.len() + 1;
            params_vec.push(rusqlite::types::Value::Text(title_contains_pattern));
            sql.push_str(&format!(
                " + CASE WHEN LOWER(COALESCE(json_extract(tags, '$[0]'), '')) LIKE ?{} ESCAPE '\\' THEN 520 ELSE 0 END",
                title_contains_idx
            ));

            let tag_exact_idx = params_vec.len() + 1;
            params_vec.push(rusqlite::types::Value::Text(exact_tag_pattern));
            sql.push_str(&format!(
                " + CASE WHEN LOWER(tags) LIKE ?{} ESCAPE '\\' THEN 420 ELSE 0 END",
                tag_exact_idx
            ));

            let content_exact_idx = params_vec.len() + 1;
            params_vec.push(rusqlite::types::Value::Text(normalized_query.clone()));
            sql.push_str(&format!(
                " + CASE WHEN LOWER(content) = ?{} THEN 260 ELSE 0 END",
                content_exact_idx
            ));

            let contains_idx = params_vec.len() + 1;
            params_vec.push(rusqlite::types::Value::Text(contains_pattern.clone()));
            sql.push_str(&format!(
                " + CASE WHEN LOWER(content) LIKE ?{} ESCAPE '\\' THEN 160 ELSE 0 END",
                contains_idx
            ));

            let tags_contains_idx = params_vec.len() + 1;
            params_vec.push(rusqlite::types::Value::Text(contains_pattern));
            sql.push_str(&format!(
                " + CASE WHEN LOWER(tags) LIKE ?{} ESCAPE '\\' THEN 240 ELSE 0 END",
                tags_contains_idx
            ));

            if let Some(fts_phrase_query) = fts_phrase_query {
                let fts_phrase_idx = params_vec.len() + 1;
                params_vec.push(rusqlite::types::Value::Text(fts_phrase_query));
                sql.push_str(&format!(
                    " + CASE WHEN EXISTS (
                        SELECT 1 FROM document_entries_fts
                        WHERE document_entries_fts.item_id = clipboard_history.id
                          AND document_entries_fts MATCH ?{}
                    ) THEN 220 ELSE 0 END",
                    fts_phrase_idx
                ));
            }

            if let Some(fts_query) = fts_query {
                let fts_idx = params_vec.len() + 1;
                params_vec.push(rusqlite::types::Value::Text(fts_query));
                sql.push_str(&format!(
                    " + CASE WHEN EXISTS (
                        SELECT 1 FROM document_entries_fts
                        WHERE document_entries_fts.item_id = clipboard_history.id
                          AND document_entries_fts MATCH ?{}
                    ) THEN 120 ELSE 0 END",
                    fts_idx
                ));
            }

            sql.push_str(") AS search_rank");
        }
    }

    sql.push_str(" FROM clipboard_history WHERE library_id = ?1");

    if let Some(ref cat) = category {
        if !cat.is_empty() && cat != "全部" && cat != "All" && cat != "历史" && cat != "History" {
            sql.push_str(" AND category = ?2");
            params_vec.push(rusqlite::types::Value::Text(cat.clone()));
        }
    }

    if let Some(ref ids) = item_ids {
        let filtered_ids = ids
            .iter()
            .map(|id| id.trim())
            .filter(|id| !id.is_empty())
            .collect::<Vec<_>>();
        if filtered_ids.is_empty() {
            return Ok("[]".to_string());
        }

        let placeholders = (0..filtered_ids.len())
            .map(|idx| format!("?{}", params_vec.len() + idx + 1))
            .collect::<Vec<_>>()
            .join(", ");
        sql.push_str(&format!(" AND id IN ({})", placeholders));
        for id in filtered_ids {
            params_vec.push(rusqlite::types::Value::Text(id.to_string()));
        }
    }

    if let Some(ref q) = search_query {
        if !q.trim().is_empty() {
            let param_idx = params_vec.len() + 1;
            let normalized_search = q.trim().to_lowercase();
            let search_pattern = format!("%{}%", escape_like_pattern(&normalized_search));
            let fts_query = build_document_entries_fts_query(q.trim());
            if let Some(fts_query) = fts_query {
                let fts_param_idx = param_idx + 1;
                sql.push_str(&format!(
                    " AND (
                        LOWER(content) LIKE ?{0} ESCAPE '\'
                        OR LOWER(tags) LIKE ?{0} ESCAPE '\'
                        OR EXISTS (
                            SELECT 1 FROM document_entries_fts
                            WHERE document_entries_fts.item_id = clipboard_history.id
                              AND document_entries_fts MATCH ?{1}
                        )
                    )",
                    param_idx,
                    fts_param_idx
                ));
                params_vec.push(rusqlite::types::Value::Text(search_pattern));
                params_vec.push(rusqlite::types::Value::Text(fts_query));
            } else {
                sql.push_str(&format!(
                    " AND (
                        LOWER(content) LIKE ?{0} ESCAPE '\'
                        OR LOWER(tags) LIKE ?{0} ESCAPE '\'
                    )",
                    param_idx
                ));
                params_vec.push(rusqlite::types::Value::Text(search_pattern));
            }
        }
    }

    if let Some(ref parent) = parent_id {
        if !parent.trim().is_empty() {
            let parent_param_idx = params_vec.len() + 1;
            sql.push_str(&format!(" AND parent_id = ?{}", parent_param_idx));
            params_vec.push(rusqlite::types::Value::Text(parent.trim().to_string()));
        }
    } else if root_only {
        sql.push_str(" AND parent_id IS NULL");
    }

    if has_search_ranking {
        sql.push_str(" ORDER BY search_rank DESC, timestamp DESC, id ASC LIMIT ?");
    } else {
        sql.push_str(" ORDER BY timestamp DESC, id ASC LIMIT ?");
    }
    sql.push_str(&(params_vec.len() + 1).to_string());
    sql.push_str(" OFFSET ?");
    sql.push_str(&(params_vec.len() + 2).to_string());
    
    params_vec.push(rusqlite::types::Value::Integer(limit));
    params_vec.push(rusqlite::types::Value::Integer(offset));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(rusqlite::params_from_iter(params_vec.iter()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, i32>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, String>(8)?,
        ))
    }).map_err(|e| e.to_string())?;

    let mut db_rows = Vec::new();
    for row in rows {
        db_rows.push(row.map_err(|e| e.to_string())?);
    }

    let materialized_docs = if include_document_content {
        let document_rows = db_rows
            .iter()
            .filter(|(_, _, _, _, item_type, _, _, _, _)| item_type == "DOCUMENT")
            .map(|(id, content, _, _, _, _, _, _, tags)| (id.clone(), content.clone(), tags.clone()))
            .collect::<Vec<_>>();
        materialize_document_content_by_id(&conn, &document_rows)?
    } else {
        HashMap::new()
    };

    let items = db_rows
        .into_iter()
        .map(|(id, content, title, body, item_type, is_pinned, timestamp, category, tags_str)| {
            let tags: serde_json::Value = serde_json::from_str(&tags_str).unwrap_or(serde_json::Value::Null);
            let final_content = if item_type == "DOCUMENT" && include_document_content {
                materialized_docs
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| "{}".to_string())
            } else {
                content
            };

            serde_json::json!({
                "id": id,
                "content": final_content,
                "title": title,
                "body": body,
                "type": item_type,
                "isPinned": is_pinned == 1,
                "timestamp": timestamp,
                "category": category,
                "tags": tags,
                "documentContentLoaded": item_type != "DOCUMENT" || include_document_content
            })
        })
        .collect::<Vec<_>>();

    serde_json::to_string(&items).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_upsert_item(
    app: tauri::AppHandle,
    conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    item_json: String,
    library_id: String,
) -> Result<(), String> {
    let item: serde_json::Value = serde_json::from_str(&item_json).map_err(|e| e.to_string())?;
    
            let id = item["id"].as_str().unwrap_or("");
            let mut content = item["content"].as_str().unwrap_or("").to_string();
            let item_type = item["type"].as_str().unwrap_or("TEXT");
            let is_pinned = if item["isPinned"].as_bool().unwrap_or(false) { 1 } else { 0 };
            let timestamp = item["timestamp"].as_i64().unwrap_or(0);
            let category = item["category"].as_str().unwrap_or("Uncategorized");
            let tags_json = item["tags"].to_string();
            let parent_id = get_parent_id_from_tags(&tags_json);
            let title = item.get("title").and_then(|v| v.as_str()).map(|s| s.to_string());
            let mut body = item.get("body").and_then(|v| v.as_str()).map(|s| s.to_string());
    let mut conn = conn.lock().unwrap();
    let mut pending_vault_write = None;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    if item_type == "DOCUMENT" {
        let old_path_info = tx
            .query_row(
                "SELECT category, tags FROM clipboard_history WHERE id = ?1 LIMIT 1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?.unwrap_or_else(|| "Uncategorized".to_string()),
                        row.get::<_, String>(1)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .map(|(old_category, old_tags_json)| {
                let old_parent_path = resolve_parent_path(&tx, &old_tags_json);
                (old_category, old_tags_json, old_parent_path)
            });

        let normalized_content = normalize_document_content_json(&content, &tags_json)?;
        sync_document_entries(&tx, id, &tags_json, &normalized_content)?;

        let parent_path = resolve_parent_path(&tx, &tags_json);
        pending_vault_write = Some(PendingVaultWrite {
            item_id: id.to_string(),
            library_id: library_id.clone(),
            category: category.to_string(),
            tags_json: tags_json.clone(),
            content: normalized_content,
            parent_path,
            old_path_info,
        });
        content = "{}".to_string();
        body = None;
    } else {
        delete_document_entries_fts_for_item(&tx, id)?;
        tx.execute("DELETE FROM document_entries WHERE item_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if body.as_ref().map(|v| v.trim().is_empty()).unwrap_or(true) {
            body = Some(content.clone());
        }
    }

    let sql = "
            INSERT INTO clipboard_history (id, content, title, body, item_type, is_pinned, timestamp, category, tags, parent_id, library_id)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(id) DO UPDATE SET
                content = excluded.content,
                title = excluded.title,
                body = excluded.body,
                item_type = excluded.item_type,
                is_pinned = excluded.is_pinned,
                timestamp = excluded.timestamp,
                category = excluded.category,
                tags = excluded.tags,
                parent_id = excluded.parent_id,
                library_id = excluded.library_id
            ";
            tx.execute(sql, params![
                id, content, title, body, item_type, is_pinned, timestamp, category, tags_json, parent_id, library_id
            ]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);

    if let Some(pending_vault_write) = pending_vault_write {
        flush_pending_vault_write(&app, pending_vault_write)?;
    }

    Ok(())
}

#[tauri::command]
pub fn db_save_document_entry(
    app: tauri::AppHandle,
    conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    item_id: String,
    library_id: String,
    tags_json: String,
    category: Option<String>,
    is_pinned: bool,
    timestamp: i64,
    previous_tag_name: Option<String>,
    tag_name: String,
    content: String,
) -> Result<(), String> {
    let category = category.unwrap_or_else(|| "Uncategorized".to_string());
    let parent_id = get_parent_id_from_tags(&tags_json);
    let mut conn = conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let old_path_info = tx
        .query_row(
            "SELECT category, tags FROM clipboard_history WHERE id = ?1 LIMIT 1",
            params![item_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?.unwrap_or_else(|| "Uncategorized".to_string()),
                    row.get::<_, String>(1)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .map(|(old_category, old_tags_json)| {
            let old_parent_path = resolve_parent_path(&tx, &old_tags_json);
            (old_category, old_tags_json, old_parent_path)
        });

    let valid_tags = get_visible_document_tags(&tags_json)
        .into_iter()
        .collect::<HashSet<_>>();
    if !valid_tags.contains(&tag_name) {
        return Err("Edited document tag is missing from the item tags".to_string());
    }

    let previous_name = previous_tag_name
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| tag_name.clone());

    let preserved_status = tx
        .query_row(
            "SELECT status FROM document_entries WHERE item_id = ?1 AND tag_name = ?2 LIMIT 1",
            params![item_id, previous_name],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();

    if previous_name != tag_name {
        delete_document_entry_fts(&tx, &item_id, &previous_name)?;
        delete_document_entry_fts(&tx, &item_id, &tag_name)?;
        tx.execute(
            "DELETE FROM document_entries WHERE item_id = ?1 AND tag_name IN (?2, ?3)",
            params![item_id, previous_name, tag_name],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.execute(
        "INSERT INTO document_entries (item_id, tag_name, content, status)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(item_id, tag_name) DO UPDATE SET
            content = excluded.content,
            status = COALESCE(excluded.status, document_entries.status)",
        params![&item_id, &tag_name, &content, preserved_status],
    )
    .map_err(|e| e.to_string())?;
    upsert_document_entry_fts(&tx, &item_id, &tag_name, &content)?;

    {
        let mut stmt = tx
            .prepare("SELECT tag_name FROM document_entries WHERE item_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![item_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut stale_tags = Vec::new();
        for row in rows {
            let existing_tag = row.map_err(|e| e.to_string())?;
            if !valid_tags.contains(&existing_tag) {
                stale_tags.push(existing_tag);
            }
        }
        drop(stmt);

        if !stale_tags.is_empty() {
            let mut delete_stmt = tx
                .prepare("DELETE FROM document_entries WHERE item_id = ?1 AND tag_name = ?2")
                .map_err(|e| e.to_string())?;
            for stale_tag in stale_tags {
                delete_document_entry_fts(&tx, &item_id, &stale_tag)?;
                delete_stmt
                    .execute(params![item_id, stale_tag])
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    tx.execute(
        "INSERT INTO clipboard_history (id, content, item_type, is_pinned, timestamp, category, tags, parent_id, library_id)
         VALUES (?1, '{}', 'DOCUMENT', ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            content = excluded.content,
            item_type = excluded.item_type,
            is_pinned = excluded.is_pinned,
            timestamp = excluded.timestamp,
            category = excluded.category,
            tags = excluded.tags,
            parent_id = excluded.parent_id,
            library_id = excluded.library_id",
        params![
            item_id,
            if is_pinned { 1 } else { 0 },
            timestamp,
            category,
            tags_json,
            parent_id,
            library_id
        ],
    )
    .map_err(|e| e.to_string())?;

    let materialized_content = materialize_document_content_by_id(
        &tx,
        &[(item_id.clone(), "{}".to_string(), tags_json.clone())],
    )?
    .remove(&item_id)
    .unwrap_or_else(|| "{}".to_string());
    let parent_path = resolve_parent_path(&tx, &tags_json);
    let pending_vault_write = PendingVaultWrite {
        item_id: item_id.clone(),
        library_id: library_id.clone(),
        category: category.clone(),
        tags_json: tags_json.clone(),
        content: materialized_content,
        parent_path,
        old_path_info,
    };

    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);

    flush_pending_vault_write(&app, pending_vault_write)?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_item(
    app: tauri::AppHandle,
    conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    id: String,
) -> Result<(), String> {
    let mut conn = conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Get item info before deletion
    let item_info: Option<(String, String, String, Option<String>)> = tx.query_row(
        "SELECT item_type, content, tags, category FROM clipboard_history WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
    ).ok();

    if let Some((item_type, content, tags_json, category)) = item_info {
        if item_type == "DOCUMENT" {
            // Delete from Vault
            let tags: serde_json::Value = serde_json::from_str(&tags_json).unwrap_or(serde_json::Value::Null);
            let title = if let Some(arr) = tags.as_array() {
                arr.get(0).and_then(|v| v.as_str()).unwrap_or("未命名文档")
            } else { "未命名文档" };

            if let Ok(vault_dir) = get_vault_dir(&app) {
                let cat_str = category.unwrap_or_else(|| "Uncategorized".to_string());
                let library_id = tx.query_row("SELECT library_id FROM clipboard_history WHERE id = ?1", params![id], |row| row.get::<_, String>(0)).unwrap_or_else(|_| "default".to_string());
                let parent_path = resolve_parent_path(&tx, &tags_json);
                
                let mut path = vault_dir.join(library_id).join(safe_filename(&cat_str));
                for p in parent_path {
                    path = path.join(safe_filename(&p));
                }
                
                let folder_path = path.join(safe_filename(title));
                let file_path = path.join(format!("{}.md", safe_filename(title)));
                
                if folder_path.exists() { let _ = std::fs::remove_dir_all(folder_path); }
                if file_path.exists() { let _ = std::fs::remove_file(file_path); }
            }
        } else if item_type == "IMAGE" && content.contains("clipboard_images") {
             let _ = std::fs::remove_file(std::path::Path::new(&content));
        }
    }

    delete_document_entries_fts_for_item(&tx, &id)?;
    tx.execute("DELETE FROM document_entries WHERE item_id = ?1", params![id.clone()]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM clipboard_history WHERE id = ?1", params![id.clone()]).map_err(|e| e.to_string())?;

    // 记录删除日志（供增量同步传播删除）
    {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let _ = tx.execute(
            "INSERT OR REPLACE INTO sync_deleted_log (id, library_id, deleted_at) VALUES (?1, '', ?2)",
            params![id, now_ms],
        );
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_update_items_order(
    _conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    _items_json: String,
) -> Result<(), String> {
    // Currently relying on timestamps for order, so we may update timestamps here if needed.
    Ok(())
}

#[tauri::command]
pub fn db_cleanup_old_history(
    conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    days: i64,
) -> Result<(), String> {
    let conn = conn.lock().unwrap();
    let cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64 - (days * 24 * 60 * 60 * 1000);

    conn.execute(
        "DELETE FROM clipboard_history WHERE timestamp < ?1 AND is_pinned = 0",
        params![cutoff],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_restore_from_backup(_app: tauri::AppHandle) -> Result<(), String> {
    // Implementation for DB restore
    Ok(())
}

#[tauri::command]
pub fn db_move_category_to_library(
    _conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    _category: String,
    _from_lib: String,
    _to_lib: String,
) -> Result<(), String> { Ok(()) }

#[tauri::command]
pub fn get_default_config(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(path) = resolve_resource_file(&app, "default_app_config.json") {
        std::fs::read_to_string(path).map_err(|e| e.to_string())
    } else {
        Ok("{}".to_string())
    }
}

#[tauri::command]
pub fn db_rename_category(
    app: tauri::AppHandle,
    conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    library_id: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    let mut conn_lock = conn.lock().unwrap();
    let tx = conn_lock.transaction().map_err(|e| e.to_string())?;

    // 1. Update SQLite Index
    tx.execute(
        "UPDATE clipboard_history SET category = ?1 WHERE library_id = ?2 AND category = ?3",
        params![new_name, library_id, old_name],
    ).map_err(|e| e.to_string())?;

    // 2. Rename Physical Disk Mirror Category Folder
    if let Ok(vault_dir) = get_vault_dir(&app) {
        let old_path = vault_dir.join(&library_id).join(safe_filename(&old_name));
        let new_path = vault_dir.join(&library_id).join(safe_filename(&new_name));

        if old_path.exists() {
            let _ = std::fs::rename(old_path, new_path);
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_items_by_category(
    app: tauri::AppHandle,
    conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    library_id: String,
    category: String,
) -> Result<(), String> {
    let mut conn_lock = conn.lock().unwrap();
    let tx = conn_lock.transaction().map_err(|e| e.to_string())?;

    // 1. Delete Physical Disk Mirror Category Folder Workspace
    if let Ok(vault_dir) = get_vault_dir(&app) {
        let cat_path = vault_dir.join(&library_id).join(safe_filename(&category));
        if cat_path.exists() {
            let _ = std::fs::remove_dir_all(cat_path);
        }
    }

    // 2. Clear SQLite Index Rows
    tx.execute(
        "DELETE FROM clipboard_history WHERE library_id = ?1 AND category = ?2",
        params![library_id, category],
    ).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn find_backup_root(path: &std::path::Path, max_depth: usize) -> Option<std::path::PathBuf> {
    if !path.exists() || !path.is_dir() {
        return None;
    }

    if path.join("app_config.json").exists() && path.join("clipboard_data").exists() {
        return Some(path.to_path_buf());
    }

    if max_depth == 0 {
        return None;
    }

    let entries = std::fs::read_dir(path).ok()?;
    for entry in entries.flatten() {
        let child = entry.path();
        if !child.is_dir() {
            continue;
        }
        if let Some(found) = find_backup_root(&child, max_depth - 1) {
            return Some(found);
        }
    }

    None
}

fn resolve_seed_root_from_dir(path: &std::path::Path) -> Option<std::path::PathBuf> {
    if !path.exists() || !path.is_dir() {
        return None;
    }

    if let Some(direct_root) = find_backup_root(path, 0) {
        return Some(direct_root);
    }

    let mut candidates: Vec<std::path::PathBuf> = std::fs::read_dir(path)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|child| child.is_dir())
        .filter_map(|child| find_backup_root(&child, 2))
        .collect();

    candidates.sort();
    candidates.dedup();

    // Fixed seed semantics: accept exactly one nested seed root.
    if candidates.len() == 1 {
        candidates.into_iter().next()
    } else {
        None
    }
}

fn resolve_official_seed_root(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    for root in candidate_resource_roots(app) {
        if let Some(seed_root) = resolve_seed_root_from_dir(&root.join("official_seed")) {
            return Some(seed_root);
        }
    }

    None
}

fn validate_official_seed_root(seed_root: &std::path::Path) -> Vec<String> {
    let mut issues = Vec::new();

    let app_config_path = seed_root.join("app_config.json");
    if !app_config_path.is_file() {
        issues.push("missing app_config.json".to_string());
    } else if let Ok(text) = std::fs::read_to_string(&app_config_path) {
        if serde_json::from_str::<serde_json::Value>(&text).is_err() {
            issues.push("app_config.json is not valid JSON".to_string());
        }
    } else {
        issues.push("app_config.json cannot be read".to_string());
    }

    let libs_root = seed_root.join("clipboard_data");
    if !libs_root.is_dir() {
        issues.push("missing clipboard_data directory".to_string());
        return issues;
    }

    let mut found_library = false;
    let entries = match std::fs::read_dir(&libs_root) {
        Ok(v) => v,
        Err(_) => {
            issues.push("clipboard_data cannot be read".to_string());
            return issues;
        }
    };

    for entry in entries.flatten() {
        let lib_dir = entry.path();
        if !lib_dir.is_dir() {
            continue;
        }
        found_library = true;

        let full_data_path = lib_dir.join("full_data.json");
        if !full_data_path.is_file() {
            issues.push(format!(
                "library '{}' missing full_data.json",
                entry.file_name().to_string_lossy()
            ));
            continue;
        }

        match std::fs::read_to_string(&full_data_path) {
            Ok(content) => {
                if serde_json::from_str::<Vec<serde_json::Value>>(&content).is_err() {
                    issues.push(format!(
                        "library '{}' has invalid full_data.json",
                        entry.file_name().to_string_lossy()
                    ));
                }
            }
            Err(_) => issues.push(format!(
                "library '{}' full_data.json cannot be read",
                entry.file_name().to_string_lossy()
            )),
        }
    }

    if !found_library {
        issues.push("clipboard_data has no library folders".to_string());
    }

    issues
}

#[tauri::command]
pub fn validate_official_seed_package(app: tauri::AppHandle) -> Result<(), String> {
    // Silently pass if official seed package doesn't exist (optional feature)
    let seed_root = match resolve_official_seed_root(&app) {
        Some(root) => root,
        None => return Ok(()),
    };
    let issues = validate_official_seed_root(&seed_root);

    if issues.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Official seed package is invalid: {}",
            issues.join("; ")
        ))
    }
}

fn read_official_seed(
    app: &tauri::AppHandle,
) -> Result<(Vec<serde_json::Value>, Vec<serde_json::Value>), String> {
    let backup_root = resolve_official_seed_root(app)
        .ok_or_else(|| "Official seed package not found in resources".to_string())?;

    let issues = validate_official_seed_root(&backup_root);
    if !issues.is_empty() {
        return Err(format!(
            "Official seed package is invalid: {}",
            issues.join("; ")
        ));
    }

    let app_config_path = backup_root.join("app_config.json");
    let app_config_text = std::fs::read_to_string(&app_config_path).map_err(|e| e.to_string())?;
    let app_config_json: serde_json::Value =
        serde_json::from_str(&app_config_text).map_err(|e| e.to_string())?;
    let shortcuts = app_config_json
        .get("shortcuts")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let libs_root = backup_root.join("clipboard_data");
    if !libs_root.exists() {
        return Ok((shortcuts, Vec::new()));
    }

    let mut first_full_data: Option<Vec<serde_json::Value>> = None;
    let mut default_full_data: Option<Vec<serde_json::Value>> = None;

    for entry in std::fs::read_dir(libs_root).map_err(|e| e.to_string())? {
        let entry = match entry {
            Ok(v) => v,
            Err(_) => continue,
        };
        let lib_dir = entry.path();
        if !lib_dir.is_dir() {
            continue;
        }

        let full_data_path = lib_dir.join("full_data.json");
        if !full_data_path.exists() {
            continue;
        }

        let full_data_text = std::fs::read_to_string(&full_data_path).map_err(|e| e.to_string())?;
        let full_data_json: Vec<serde_json::Value> =
            serde_json::from_str(&full_data_text).map_err(|e| e.to_string())?;

        if first_full_data.is_none() {
            first_full_data = Some(full_data_json.clone());
        }

        let folder_name = entry.file_name().to_string_lossy().to_string();
        let metadata_path = lib_dir.join("metadata.json");
        let original_name = if metadata_path.exists() {
            std::fs::read_to_string(&metadata_path)
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v.get("original_name").and_then(|v| v.as_str()).map(str::to_string))
                .unwrap_or(folder_name.clone())
        } else {
            folder_name.clone()
        };

        if original_name.contains("默认") || folder_name.contains("默认") || original_name.eq_ignore_ascii_case("default") {
            default_full_data = Some(full_data_json);
        }
    }

    Ok((shortcuts, default_full_data.or(first_full_data).unwrap_or_default()))
}

#[tauri::command]
pub fn get_official_seed_signature(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(backup_root) = resolve_official_seed_root(&app) {
        let root_name = backup_root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("official_backup");
        return Ok(root_name.replace(|c: char| !c.is_ascii_alphanumeric(), "_"));
    }

    if let Some(default_clipboard_path) = resolve_resource_file(&app, "default_clipboard.json") {
        let clipboard_content =
            std::fs::read_to_string(&default_clipboard_path).map_err(|e| e.to_string())?;
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        clipboard_content.hash(&mut hasher);
        return Ok(format!("default_clipboard_{:x}", hasher.finish()));
    }

    Ok("default_seed_unknown".to_string())
}

#[tauri::command]
pub fn db_seed_default_library(
    app: tauri::AppHandle,
    conn: tauri::State<'_, std::sync::Mutex<Connection>>,
) -> Result<String, String> {
    db_import_official_seed_impl(app, conn, true, true)
}

fn db_import_official_seed_impl(
    app: tauri::AppHandle,
    conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    import_cards: bool,
    import_shortcuts: bool,
) -> Result<String, String> {
    let (official_shortcuts, official_items) =
        read_official_seed(&app).unwrap_or((Vec::new(), Vec::new()));
    let use_official_backup = !official_items.is_empty();

    if !import_cards && !import_shortcuts {
        return Ok("[]".to_string());
    }

    let mut conn = conn.lock().unwrap();
    if import_cards {
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let items: Vec<serde_json::Value> = if use_official_backup {
            official_items
        } else {
            let path = resolve_resource_file(&app, "default_clipboard.json")
                .ok_or_else(|| "default_clipboard.json not found in resources".to_string())?;
            let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
            serde_json::from_str(&content).map_err(|e| e.to_string())?
        };

        if use_official_backup {
            tx.execute(
                "DELETE FROM document_entries_fts
                 WHERE item_id IN (SELECT id FROM clipboard_history WHERE library_id = 'default')",
                [],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "DELETE FROM document_entries
                 WHERE item_id IN (SELECT id FROM clipboard_history WHERE library_id = 'default')",
                [],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "DELETE FROM clipboard_history WHERE library_id = 'default'",
                [],
            )
            .map_err(|e| e.to_string())?;
        }

        let now_ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        for item in items {
            let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if id.is_empty() {
                continue;
            }

            let mut content = item
                .get("content")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| item.get("content").map(|v| v.to_string()).unwrap_or_default());
            let item_type = item
                .get("type")
                .or_else(|| item.get("item_type"))
                .and_then(|v| v.as_str())
                .unwrap_or("TEXT")
                .to_string();
            let is_pinned = item
                .get("isPinned")
                .or_else(|| item.get("is_pinned"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let timestamp = item
                .get("timestamp")
                .and_then(|v| v.as_i64())
                .unwrap_or(now_ts);
            let category = item
                .get("category")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let raw_tags = item
                .get("tags")
                .and_then(|value| value.as_array())
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|value| value.as_str().map(|text| text.trim().to_string()))
                        .filter(|text| !text.is_empty())
                        .collect::<Vec<String>>()
                })
                .unwrap_or_default();

            let normalized_tags = if item_type.eq_ignore_ascii_case("TAGS") {
                normalize_seed_tags_for_import(raw_tags, &content)
            } else {
                raw_tags
            };

            if item_type.eq_ignore_ascii_case("TAGS") {
                content = rebuild_seed_tags_content(&normalized_tags, &content);
            }

            let tags_json = serde_json::to_string(&normalized_tags).unwrap_or_else(|_| "[]".to_string());
            let parent_id = get_parent_id_from_tags(&tags_json);

            let sql = if use_official_backup {
                "INSERT OR REPLACE INTO clipboard_history (id, content, item_type, is_pinned, timestamp, category, tags, parent_id, library_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
            } else {
                "INSERT OR IGNORE INTO clipboard_history (id, content, item_type, is_pinned, timestamp, category, tags, parent_id, library_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
            };

            tx.execute(
                sql,
                params![
                    id,
                    content,
                    item_type,
                    if is_pinned { 1 } else { 0 },
                    timestamp,
                    if category.is_empty() { None } else { Some(category) },
                    tags_json,
                    parent_id,
                    "default"
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        tx.commit().map_err(|e| e.to_string())?;
    }

    let shortcuts_result = if import_shortcuts {
        official_shortcuts
    } else {
        Vec::new()
    };
    serde_json::to_string(&shortcuts_result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_import_official_seed(
    app: tauri::AppHandle,
    conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    import_cards: Option<bool>,
    import_shortcuts: Option<bool>,
) -> Result<String, String> {
    db_import_official_seed_impl(
        app,
        conn,
        import_cards.unwrap_or(true),
        import_shortcuts.unwrap_or(true),
    )
}

pub fn seed_config_if_needed(_app: tauri::AppHandle) -> Result<(), String> { Ok(()) }

#[tauri::command]
pub fn db_reveal_vault(app: tauri::AppHandle) -> Result<(), String> {
    let vault_dir = get_vault_dir(&app)?;
    if !vault_dir.exists() {
        let _ = std::fs::create_dir_all(&vault_dir);
    }
    
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(vault_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[derive(Clone)]
struct VaultItemMeta {
    id: String,
    timestamp: i64,
    tags: serde_json::Value,
}

fn build_vault_item_lookup(
    conn: &Connection,
    library_id: &str,
    category: &str,
    parent_path: &[String],
) -> Result<(HashMap<String, VaultItemMeta>, HashMap<String, VaultItemMeta>), String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, tags, timestamp
             FROM clipboard_history
             WHERE category = ?1 AND library_id = ?2 AND item_type = 'DOCUMENT'",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![category, library_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut dir_lookup = HashMap::new();
    let mut file_lookup = HashMap::new();

    for row in rows {
        let (id, tags_json, timestamp) = row.map_err(|e| e.to_string())?;
        if resolve_parent_path(conn, &tags_json) != parent_path {
            continue;
        }

        let tags =
            serde_json::from_str::<serde_json::Value>(&tags_json).unwrap_or(serde_json::Value::Null);
        let meta = VaultItemMeta {
            id,
            timestamp,
            tags: tags.clone(),
        };

        if let Some(title) = tags
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|value| value.as_str())
        {
            let normalized_title = title
                .strip_prefix('\u{1F4C1}')
                .map(str::trim)
                .or_else(|| title.strip_prefix("📂").map(str::trim))
                .unwrap_or(title);
            dir_lookup
                .entry(safe_filename(normalized_title))
                .or_insert_with(|| meta.clone());
        }

        for tag_name in get_visible_document_tags(&tags_json) {
            file_lookup
                .entry(safe_filename(&tag_name))
                .or_insert_with(|| meta.clone());
        }
    }

    Ok((dir_lookup, file_lookup))
}

#[derive(Clone)]
struct PendingVaultWrite {
    item_id: String,
    library_id: String,
    category: String,
    tags_json: String,
    content: String,
    parent_path: Vec<String>,
    old_path_info: Option<(String, String, Vec<String>)>,
}

fn flush_pending_vault_write(
    app: &tauri::AppHandle,
    pending: PendingVaultWrite,
) -> Result<(), String> {
    let vault_dir = get_vault_dir(app)?;
    let mut last_error = None;

    for delay_ms in [0_u64, 80, 200] {
        if delay_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        }

        match save_document_to_vault(
            &vault_dir,
            Some(&pending.item_id),
            &pending.library_id,
            &pending.category,
            &pending.tags_json,
            &pending.content,
            pending.parent_path.clone(),
            pending.old_path_info.clone(),
        ) {
            Ok(()) => return Ok(()),
            Err(error) => last_error = Some(error),
        }
    }

    Err(format!(
        "Database saved, but Vault sync failed after retries: {}",
        last_error.unwrap_or_else(|| "unknown Vault sync error".to_string())
    ))
}

#[tauri::command]
pub fn db_load_vault_items(
    app: tauri::AppHandle,
    library_id: String,
    category: String,
    parent_path_json: String
) -> Result<String, String> {
    let parent_path: Vec<String> = serde_json::from_str(&parent_path_json).unwrap_or_default();
    let vault_dir = get_vault_dir(&app)?;
    
    let mut path = vault_dir.join(&library_id).join(safe_filename(&category));
    for p in &parent_path {
        path = path.join(safe_filename(p));
    }

    let mut items = Vec::new();

    let conn = open_read_db(&app)?;
    let (dir_lookup, file_lookup) =
        build_vault_item_lookup(&conn, &library_id, &category, &parent_path)?;

    if let Ok(entries) = std::fs::read_dir(&path) {
        for entry in entries.flatten() {
            let p = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') { continue; }

            if p.is_dir() {
                let db_meta = dir_lookup.get(&name);
                let id = db_meta
                    .map(|meta| meta.id.clone())
                    .unwrap_or_else(|| format!("hash_{}", name));
                items.push(serde_json::json!({
                    "id": id,
                    "content": "",
                    "type": "DOCUMENT",
                    "isPinned": false,
                    "timestamp": db_meta.map(|meta| meta.timestamp).unwrap_or(0),
                    "category": category,
                    "tags": db_meta
                        .map(|meta| meta.tags.clone())
                        .unwrap_or_else(|| serde_json::json!([format!("📂 {}", name)]))
                }));
            } else if p.extension().and_then(|s| s.to_str()) == Some("md") {
                let file_stem = p.file_stem().unwrap().to_string_lossy().to_string();
                let content = std::fs::read_to_string(&p).unwrap_or_default();
                
                let db_meta = file_lookup.get(&file_stem);
                let id = db_meta
                    .map(|meta| meta.id.clone())
                    .unwrap_or_else(|| format!("hash_{}", file_stem));
                items.push(serde_json::json!({
                    "id": id,
                    "content": content,
                    "type": "DOCUMENT",
                    "isPinned": false,
                    "timestamp": db_meta.map(|meta| meta.timestamp).unwrap_or(0),
                    "category": category,
                    "tags": db_meta
                        .map(|meta| meta.tags.clone())
                        .unwrap_or_else(|| serde_json::json!([&file_stem]))
                }));
            }
        }
    }

    serde_json::to_string(&items).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_load_categories(app: tauri::AppHandle, library_id: String) -> Result<Vec<String>, String> {
    let vault_dir = get_vault_dir(&app)?;
    let lib_path = vault_dir.join(&library_id);
    
    let mut cats = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&lib_path) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with('.') {
                    cats.push(name);
                }
            }
        }
    }
    Ok(cats)
}

#[tauri::command]
pub fn db_export_to_vault(app: tauri::AppHandle, conn: tauri::State<'_, std::sync::Mutex<Connection>>, library_id: String) -> Result<String, String> {
    let vault_dir = get_vault_dir(&app)?;
    let conn = conn.lock().unwrap();
    
    let mut stmt = conn.prepare("SELECT id, content, item_type, category, tags FROM clipboard_history WHERE library_id = ?1").map_err(|e| e.to_string())?;
    let item_iter = stmt.query_map(params![library_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "Uncategorized".to_string()),
            row.get::<_, String>(4)?
        ))
    }).map_err(|e| e.to_string())?;

    let mut success_count = 0;
    for item in item_iter {
        if let Ok((id, content, item_type, category, tags_json)) = item {
            if item_type == "DOCUMENT" {
                 let materialized_content = materialize_document_content_by_id(
                    &conn,
                    &[(id.clone(), content, tags_json.clone())],
                 )?
                 .remove(&id)
                 .unwrap_or_else(|| "{}".to_string());
                 let parent_path = resolve_parent_path(&conn, &tags_json);
                 let _ = save_document_to_vault(&vault_dir, Some(&id), &library_id, &category, &tags_json, &materialized_content, parent_path, None);
                 success_count += 1;
            }
        }
    }
    
    Ok(format!("Successfully backed up {} documents into Vault", success_count))
}

// ─── 局域网同步辅助命令 ──────────────────────────────────────────

/// 获取自 since 时间戳以来修改的所有条目（供 syncAll push 步骤使用）
#[tauri::command]
pub fn db_get_items_since(
    conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    since: i64,
    library_id: String,
) -> Result<String, String> {
    let guard = conn.lock().unwrap();
    let items = collect_items_since(&guard, since, &library_id).map_err(|e| e.to_string())?;
    serde_json::to_string(&items).map_err(|e| e.to_string())
}

fn collect_items_since(conn: &Connection, since: i64, library_id: &str) -> rusqlite::Result<Vec<serde_json::Value>> {
    let mut result = Vec::new();
    let make_row = |row: &rusqlite::Row| -> rusqlite::Result<serde_json::Value> {
        let tags_str: String = row.get(8).unwrap_or_default();
        let tags = serde_json::from_str::<serde_json::Value>(&tags_str)
            .unwrap_or(serde_json::Value::Null);
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0).unwrap_or_default(),
            "content": row.get::<_, String>(1).unwrap_or_default(),
            "title": row.get::<_, Option<String>>(2).unwrap_or(None),
            "body": row.get::<_, Option<String>>(3).unwrap_or(None),
            "type": row.get::<_, String>(4).unwrap_or_default(),
            "isPinned": row.get::<_, i32>(5).unwrap_or(0) == 1,
            "timestamp": row.get::<_, i64>(6).unwrap_or(0),
            "category": row.get::<_, Option<String>>(7).unwrap_or(None),
            "tags": tags,
            "libraryId": row.get::<_, String>(9).unwrap_or_default(),
        }))
    };

    if library_id.is_empty() {
        let mut stmt = conn.prepare(
            "SELECT id, content, title, body, item_type, is_pinned, timestamp, category, tags, library_id \
             FROM clipboard_history WHERE timestamp > ?1 ORDER BY timestamp DESC LIMIT 500",
        )?;
        let rows = stmt.query_map([since], make_row)?;
        for r in rows.flatten() { result.push(r); }
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, content, title, body, item_type, is_pinned, timestamp, category, tags, library_id \
             FROM clipboard_history WHERE library_id = ?1 AND timestamp > ?2 ORDER BY timestamp DESC LIMIT 500",
        )?;
        let rows = stmt.query_map(params![library_id, since], make_row)?;
        for r in rows.flatten() { result.push(r); }
    }
    Ok(result)
}

/// 获取自 since 时间戳以来的已删除 ID 列表（来自 sync_deleted_log）
#[tauri::command]
pub fn db_get_deleted_since(
    conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    since: i64,
) -> Result<Vec<String>, String> {
    let guard = conn.lock().unwrap();
    let mut ids = Vec::new();
    if let Ok(mut stmt) = guard.prepare(
        "SELECT id FROM sync_deleted_log WHERE deleted_at > ?1 LIMIT 1000",
    ) {
        if let Ok(rows) = stmt.query_map([since], |row| row.get::<_, String>(0)) {
            for r in rows.flatten() { ids.push(r); }
        }
    }
    Ok(ids)
}

/// 将远端推送来的条目写入本地（增量同步，冲突解决：新 timestamp 胜）
#[tauri::command]
pub fn db_sync_items_from_remote(
    conn: tauri::State<'_, std::sync::Mutex<Connection>>,
    items_json: String,
    library_id: String,
) -> Result<usize, String> {
    let items: Vec<serde_json::Value> =
        serde_json::from_str(&items_json).map_err(|e| e.to_string())?;
    let conn = conn.lock().unwrap();
    let mut synced = 0usize;

    for item in &items {
        let id = item["id"].as_str().unwrap_or("");
        if id.is_empty() { continue; }

        let incoming_ts = item["timestamp"].as_i64().unwrap_or(0);
        // 冲突解决：本地有更新版本则跳过
        let local_ts: Option<i64> = conn
            .query_row(
                "SELECT timestamp FROM clipboard_history WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .ok();
        if let Some(local) = local_ts {
            if local > incoming_ts { continue; }
        }

        let content = item["content"].as_str().unwrap_or("");
        let title = item["title"].as_str();
        let body = item["body"].as_str();
        let item_type = item["type"].as_str()
            .or_else(|| item["item_type"].as_str())
            .unwrap_or("TEXT");
        let is_pinned = item["isPinned"].as_bool()
            .or_else(|| item["is_pinned"].as_bool())
            .unwrap_or(false) as i32;
        let category = item["category"].as_str();
        let tags = serde_json::to_string(&item["tags"]).unwrap_or_else(|_| "[]".to_string());
        let lib = item["libraryId"].as_str()
            .or_else(|| item["library_id"].as_str())
            .unwrap_or(&library_id);

        let _ = conn.execute(
            "INSERT OR REPLACE INTO clipboard_history \
             (id, content, title, body, item_type, is_pinned, timestamp, category, tags, library_id) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![id, content, title, body, item_type, is_pinned, incoming_ts, category, tags, lib],
        );
        synced += 1;
    }
    Ok(synced)
}

#[cfg(test)]
mod tests {
    use super::validate_official_seed_root;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "now_official_seed_test_{}_{}",
            std::process::id(),
            nanos
        ));
        fs::create_dir_all(&dir).expect("failed to create temp dir");
        dir
    }

    fn remove_dir_quiet(path: &Path) {
        let _ = fs::remove_dir_all(path);
    }

    #[test]
    fn validate_official_seed_root_reports_missing_required_files() {
        let dir = make_temp_dir();
        let issues = validate_official_seed_root(&dir);
        remove_dir_quiet(&dir);

        assert!(issues.iter().any(|v| v.contains("app_config.json")));
        assert!(issues.iter().any(|v| v.contains("clipboard_data")));
    }

    #[test]
    fn validate_official_seed_root_accepts_valid_minimal_structure() {
        let dir = make_temp_dir();
        fs::write(
            dir.join("app_config.json"),
            r#"{"shortcuts":[],"settings":{},"translationSettings":{}}"#,
        )
        .expect("failed to write app_config");
        let lib_dir = dir.join("clipboard_data").join("default");
        fs::create_dir_all(&lib_dir).expect("failed to create lib dir");
        fs::write(lib_dir.join("full_data.json"), "[]").expect("failed to write full_data");

        let issues = validate_official_seed_root(&dir);
        remove_dir_quiet(&dir);

        assert!(issues.is_empty(), "expected no validation issues, got: {:?}", issues);
    }
}
