use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use rusqlite::Connection;
use std::sync::{Arc, Mutex};

use super::auth::AuthStore;

/// 共享的 App 状态（在 axum handler 间传递）
#[derive(Clone)]
pub struct SyncAppState {
    pub auth: AuthStore,
    pub db: Arc<Mutex<Connection>>,
    pub device_name: String,
}

// ─── 请求/响应结构 ──────────────────────────────────────────────

#[derive(Deserialize)]
pub struct PairRequest {
    pub pin: String,
    pub device_name: String,
}

#[derive(Serialize)]
pub struct PairResponse {
    pub token: String,
}

/// push 请求：支持增量新增/更新 + 已删除 ID 传播
#[derive(Deserialize)]
pub struct PushRequest {
    pub items: Vec<Value>,
    pub library_id: String,
    /// 对端已删除的 ID 列表
    #[serde(default)]
    pub deleted_ids: Vec<String>,
}

#[derive(Serialize)]
pub struct PullResponse {
    pub items: Vec<Value>,
    pub total: usize,
    /// 自 since 以来已删除的 ID
    pub deleted_ids: Vec<String>,
}

// ─── 路由 ────────────────────────────────────────────────────────

pub fn build_router(state: SyncAppState) -> Router {
    Router::new()
        .route("/sync/info", get(handle_info))
        .route("/sync/pair", post(handle_pair))
        .route("/sync/pull", get(handle_pull))
        .route("/sync/push", post(handle_push))
        .route("/sync/pin", get(handle_get_pin))
        .route("/sync/deletelog", get(handle_deletelog))
        .with_state(state)
}

/// 初始化同步所需的辅助表（在服务器启动时调用，主要开启 WAL）
pub fn init_sync_tables(conn: &Connection) -> rusqlite::Result<()> {
    // WAL 模式：允许同步线程和主进程并发读写
    // sync_deleted_log 表已由 db.rs init_db 创建
    conn.pragma_update(None, "journal_mode", "WAL")?;
    Ok(())
}

// ─── 工具：从 header 提取并验证 Bearer token ─────────────────────

fn extract_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}

fn auth_check(headers: &HeaderMap, auth: &AuthStore) -> bool {
    if let Some(token) = extract_token(headers) {
        return auth.verify_token(&token);
    }
    false
}

// ─── Handler: GET /sync/info ─────────────────────────────────────

async fn handle_info(State(state): State<SyncAppState>) -> impl IntoResponse {
    let count: i64 = {
        let conn = state.db.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM clipboard_history", [], |r| r.get(0))
            .unwrap_or(0)
    };

    Json(json!({
        "device_name": state.device_name,
        "version": "1.0",
        "item_count": count,
    }))
}

// ─── Handler: GET /sync/pin（返回当前PIN供桌面端显示）─────────────

async fn handle_get_pin(State(state): State<SyncAppState>) -> impl IntoResponse {
    match state.auth.current_pin() {
        Some(pin) => Json(json!({ "pin": pin })).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "No active PIN. Generate one first." })),
        )
            .into_response(),
    }
}

// ─── Handler: POST /sync/pair ────────────────────────────────────

async fn handle_pair(
    State(state): State<SyncAppState>,
    Json(payload): Json<PairRequest>,
) -> impl IntoResponse {
    match state.auth.verify_pin(&payload.pin, &payload.device_name) {
        Some(token) => Json(json!({ "token": token })).into_response(),
        None => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid or expired PIN" })),
        )
            .into_response(),
    }
}

// ─── Handler: GET /sync/pull?library_id=xxx&since=timestamp ──────

async fn handle_pull(
    State(state): State<SyncAppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    if !auth_check(&headers, &state.auth) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Unauthorized" })),
        )
            .into_response();
    }

    let library_id = params.get("library_id").cloned().unwrap_or_default();
    let since: i64 = params
        .get("since")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    // ── 增量查询 items ────────────────────────────────────────────
    let items: Vec<Value> = {
        let conn = state.db.lock().unwrap();
        if library_id.is_empty() {
            query_items_since(&conn, since, None)
        } else {
            query_items_since(&conn, since, Some(&library_id))
        }
    };

    // ── 查询 deleted_ids ─────────────────────────────────────────
    let deleted_ids: Vec<String> = {
        let conn = state.db.lock().unwrap();
        query_deleted_since(&conn, since, if library_id.is_empty() { None } else { Some(&library_id) })
    };

    let total = items.len();
    Json(json!({
        "items": items,
        "total": total,
        "deleted_ids": deleted_ids,
    }))
    .into_response()
}

/// 查询自 since 以来的新增/修改条目（辅助函数，独立 stmt 作用域）
fn query_items_since(conn: &rusqlite::Connection, since: i64, library_id: Option<&str>) -> Vec<Value> {
    let mut result = Vec::new();
    if let Some(lib) = library_id {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT id, content, title, body, item_type, is_pinned, timestamp, category, tags, library_id \
             FROM clipboard_history WHERE library_id = ?1 AND timestamp > ?2 ORDER BY timestamp DESC LIMIT 500",
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![lib, since], |row| Ok(row_to_json(row))) {
                result = rows.filter_map(|r| r.ok()).collect();
            }
        }
    } else if let Ok(mut stmt) = conn.prepare(
        "SELECT id, content, title, body, item_type, is_pinned, timestamp, category, tags, library_id \
         FROM clipboard_history WHERE timestamp > ?1 ORDER BY timestamp DESC LIMIT 500",
    ) {
        if let Ok(rows) = stmt.query_map([since], |row| Ok(row_to_json(row))) {
            result = rows.filter_map(|r| r.ok()).collect();
        }
    }
    result
}

/// 查询自 since 以来的已删除 ID（辅助函数）
fn query_deleted_since(conn: &rusqlite::Connection, since: i64, library_id: Option<&str>) -> Vec<String> {
    let mut result = Vec::new();
    if let Some(lib) = library_id {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT id FROM sync_deleted_log WHERE library_id = ?1 AND deleted_at > ?2 LIMIT 500",
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![lib, since], |row| row.get(0)) {
                result = rows.filter_map(|r| r.ok()).collect();
            }
        }
    } else if let Ok(mut stmt) = conn.prepare(
        "SELECT id FROM sync_deleted_log WHERE deleted_at > ?1 LIMIT 500",
    ) {
        if let Ok(rows) = stmt.query_map([since], |row| row.get(0)) {
            result = rows.filter_map(|r| r.ok()).collect();
        }
    }
    result
}

// ─── Handler: GET /sync/deletelog?since=timestamp（独立接口）─────

async fn handle_deletelog(
    State(state): State<SyncAppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    if !auth_check(&headers, &state.auth) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Unauthorized" }))).into_response();
    }

    let since: i64 = params
        .get("since")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let deleted_ids: Vec<String> = {
        let guard = state.db.lock().unwrap();
        query_deleted_since(&guard, since, None)
    };

    Json(json!({ "deleted_ids": deleted_ids, "total": deleted_ids.len() })).into_response()
}

fn row_to_json(row: &rusqlite::Row) -> Value {
    let tags_str: String = row.get(8).unwrap_or_default();
    let tags: Value = serde_json::from_str(&tags_str).unwrap_or(Value::Null);
    json!({
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
    })
}

// ─── Handler: POST /sync/push ────────────────────────────────────

async fn handle_push(
    State(state): State<SyncAppState>,
    headers: HeaderMap,
    Json(payload): Json<PushRequest>,
) -> impl IntoResponse {
    if !auth_check(&headers, &state.auth) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Unauthorized" })),
        )
            .into_response();
    }

    let mut synced = 0usize;
    let mut skipped = 0usize; // 因冲突跳过（本地更新）
    let mut errors = 0usize;
    let mut deleted = 0usize;

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    {
        let conn = state.db.lock().unwrap();

        // ── 1. 处理推送过来的新增/更新（冲突解决：新 timestamp 胜出）──
        for item in &payload.items {
            let id = item["id"].as_str().unwrap_or("");
            let content = item["content"].as_str().unwrap_or("");
            let title = item["title"].as_str();
            let body = item["body"].as_str();
            let item_type = item["type"].as_str().unwrap_or("TEXT");
            let is_pinned = item["isPinned"].as_bool().unwrap_or(false) as i32;
            let incoming_ts = item["timestamp"].as_i64().unwrap_or(0);
            let category = item["category"].as_str();
            let tags = serde_json::to_string(&item["tags"]).unwrap_or_else(|_| "[]".to_string());
            let library_id = item["libraryId"].as_str()
                .or_else(|| item["library_id"].as_str())
                .unwrap_or(&payload.library_id);

            if id.is_empty() {
                errors += 1;
                continue;
            }

            // 检查本地是否存在更新的版本（冲突：保留较新的 timestamp）
            let local_ts: Option<i64> = conn
                .query_row(
                    "SELECT timestamp FROM clipboard_history WHERE id = ?1",
                    [id],
                    |r| r.get(0),
                )
                .ok();

            if let Some(local) = local_ts {
                if local > incoming_ts {
                    // 本地更新，跳过覆盖
                    skipped += 1;
                    continue;
                }
            }

            let result = conn.execute(
                "INSERT OR REPLACE INTO clipboard_history \
                 (id, content, title, body, item_type, is_pinned, timestamp, category, tags, library_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![
                    id, content, title, body, item_type,
                    is_pinned, incoming_ts, category, tags, library_id
                ],
            );

            match result {
                Ok(_) => synced += 1,
                Err(_) => errors += 1,
            }
        }

        // ── 2. 处理对端已删除的 ID ──────────────────────────────────
        for del_id in &payload.deleted_ids {
            // 物理删除本地记录
            let affected = conn
                .execute("DELETE FROM clipboard_history WHERE id = ?1", [del_id])
                .unwrap_or(0);

            if affected > 0 {
                deleted += 1;
            }

            // 将此 ID 写入 sync_deleted_log（避免重复传播）
            let _ = conn.execute(
                "INSERT OR IGNORE INTO sync_deleted_log (id, library_id, deleted_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![del_id, &payload.library_id, now_ms],
            );
        }
    }

    Json(json!({
        "synced": synced,
        "skipped": skipped,
        "deleted": deleted,
        "errors": errors,
        "total": payload.items.len(),
    }))
    .into_response()
}
