use reqwest::Client;
use reqwest::blocking::{Client as BlockingClient, RequestBuilder as BlockingRequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use chrono::{DateTime, Utc};

const CODE_LICENSE_ACTIVE: &str = "LICENSE_ACTIVE";
const CODE_TRIAL_ACTIVE: &str = "TRIAL_ACTIVE";
const CODE_TRIAL_EXPIRED: &str = "TRIAL_EXPIRED";
const CODE_LICENSE_VERIFIED: &str = "LICENSE_VERIFIED";
const CODE_LICENSE_UNBOUND: &str = "LICENSE_UNBOUND";
const CODE_LICENSE_DEVICES_FETCHED: &str = "LICENSE_DEVICES_FETCHED";

const CODE_INVALID_LICENSE_KEY: &str = "INVALID_LICENSE_KEY";
const CODE_MISSING_LICENSE_KEY: &str = "MISSING_LICENSE_KEY";
const CODE_MISSING_API_URL: &str = "MISSING_API_URL";
const CODE_INVALID_REQUEST: &str = "INVALID_REQUEST";
const CODE_HTTP_ERROR: &str = "HTTP_ERROR";
const CODE_NETWORK_ERROR: &str = "NETWORK_ERROR";
const CODE_PARSE_ERROR: &str = "PARSE_ERROR";
const CODE_VERIFY_FAILED: &str = "VERIFY_FAILED";
const CODE_UNBIND_FAILED: &str = "UNBIND_FAILED";
const CODE_GET_DEVICES_FAILED: &str = "GET_DEVICES_FAILED";

#[derive(Serialize, Deserialize)]
pub struct ActivationResult {
    success: bool,
    code: String,
    message: String,
    license_info: Option<LicenseInfo>,
}

impl ActivationResult {
    fn success(code: impl Into<String>, message: impl Into<String>, license_info: Option<LicenseInfo>) -> Self {
        Self {
            success: true,
            code: code.into(),
            message: message.into(),
            license_info,
        }
    }

    fn error(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            success: false,
            code: code.into(),
            message: message.into(),
            license_info: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LicenseInfo {
    key: String,
    device_id: String,
    activation_type: Option<String>,
    expires_at: Option<String>,
}

#[derive(Debug)]
struct AuthError {
    code: &'static str,
    message: String,
}

impl AuthError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

enum LicenseKeyPolicy {
    ExplicitOnly,
    ExplicitOrStored,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SecureConfig {
    first_run: u64,
    license_key: Option<String>,
    is_activated: bool,
    #[serde(default)]
    api_url: Option<String>,
    #[serde(default)]
    api_token: Option<String>,
    #[serde(default)]
    activation_type: Option<String>,
    #[serde(default)]
    expires_at: Option<String>,
}

impl SecureConfig {
    fn empty(first_run: u64) -> Self {
        Self {
            first_run,
            license_key: None,
            is_activated: false,
            api_url: None,
            api_token: None,
            activation_type: None,
            expires_at: None,
        }
    }
}

fn extract_license_meta(payload: &Value) -> (Option<String>, Option<String>) {
    let activation_type = payload
        .get("activation_type")
        .or_else(|| payload.get("type"))
        .or_else(|| payload.get("plan_type"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty());

    let expires_at = payload
        .get("expires_at")
        .or_else(|| payload.get("expiry_at"))
        .or_else(|| payload.get("expire_at"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    (activation_type, expires_at)
}

#[tauri::command]
pub fn get_machine_id() -> String {
    // Android: Use a combination of device info
    // For now, generate a stable ID based on app data directory
    if let Some(data_dir) = dirs::data_dir() {
        let id_path = data_dir.join("now_app_id");
        if let Ok(content) = fs::read_to_string(&id_path) {
            return content.trim().to_string();
        }
        // Generate new ID
        let new_id = uuid::Uuid::new_v4().to_string();
        let _ = fs::write(&id_path, &new_id);
        return new_id;
    }
    // Fallback
    uuid::Uuid::new_v4().to_string()
}

fn get_secure_config_path() -> PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("NowApp");
    if !path.exists() {
        let _ = fs::create_dir_all(&path);
    }
    path.push(".secure_config");
    path
}

fn xor_encrypt_decrypt(input: &str) -> String {
    let key = b"NOW_SECURE_KEY_XOR";
    let mut output = Vec::with_capacity(input.len());

    for (i, byte) in input.bytes().enumerate() {
        output.push(byte ^ key[i % key.len()]);
    }

    output.iter().map(|b| format!("{:02x}", b)).collect()
}

fn xor_decrypt_hex(input_hex: &str) -> String {
    let key = b"NOW_SECURE_KEY_XOR";

    let mut input_bytes = Vec::new();
    for i in (0..input_hex.len()).step_by(2) {
        if i + 2 > input_hex.len() {
            break;
        }
        if let Ok(byte) = u8::from_str_radix(&input_hex[i..i + 2], 16) {
            input_bytes.push(byte);
        }
    }

    let mut output = Vec::with_capacity(input_bytes.len());
    for (i, byte) in input_bytes.iter().enumerate() {
        output.push(byte ^ key[i % key.len()]);
    }

    String::from_utf8(output).unwrap_or_default()
}

fn normalize_license_key(raw: &str) -> Option<String> {
    let key = raw.trim().to_uppercase();
    if key.is_empty() || key == "ACTIVATED" || key == "UNKNOWN LICENSE" {
        None
    } else {
        Some(key)
    }
}

fn read_secure_config(path: &Path, default_first_run: u64) -> Option<SecureConfig> {
    let content = fs::read_to_string(path).ok()?;
    let json = xor_decrypt_hex(&content);
    serde_json::from_str(&json).ok().or_else(|| Some(SecureConfig::empty(default_first_run)))
}

fn write_secure_config(path: &Path, cfg: &SecureConfig) {
    if let Ok(json) = serde_json::to_string(cfg) {
        let _ = fs::write(path, xor_encrypt_decrypt(&json));
    }
}

fn get_stored_license_key() -> Option<String> {
    let path = get_secure_config_path();
    let cfg = read_secure_config(&path, 0)?;
    cfg.license_key.as_deref().and_then(normalize_license_key)
}

fn resolve_license_key(input_key: &str, policy: LicenseKeyPolicy) -> Result<String, AuthError> {
    if let Some(key) = normalize_license_key(input_key) {
        return Ok(key);
    }

    if matches!(policy, LicenseKeyPolicy::ExplicitOrStored) {
        if let Some(key) = get_stored_license_key() {
            return Ok(key);
        }
        return Err(AuthError::new(
            CODE_MISSING_LICENSE_KEY,
            "No valid license key found. Please reactivate and sync first.",
        ));
    }

    Err(AuthError::new(
        CODE_INVALID_LICENSE_KEY,
        "Please enter a valid license key before unbinding.",
    ))
}

fn derive_rpc_url(api_url: &str, rpc_name: &str) -> Result<String, AuthError> {
    let trimmed = api_url.trim();
    if trimmed.is_empty() {
        return Err(AuthError::new(
            CODE_MISSING_API_URL,
            "Activation server URL is missing.",
        ));
    }

    if let Some(idx) = trimmed.find("/rpc/") {
        return Ok(format!("{}{}", &trimmed[..idx + 5], rpc_name));
    }

    Ok(trimmed.to_string())
}

fn with_auth_headers(req: reqwest::RequestBuilder, api_token: Option<&str>) -> reqwest::RequestBuilder {
    match api_token {
        Some(token) if !token.trim().is_empty() => req
            .header("apikey", token)
            .header("Authorization", format!("Bearer {}", token)),
        _ => req,
    }
}

fn with_auth_headers_blocking(req: BlockingRequestBuilder, api_token: Option<&str>) -> BlockingRequestBuilder {
    match api_token {
        Some(token) if !token.trim().is_empty() => req
            .header("apikey", token)
            .header("Authorization", format!("Bearer {}", token)),
        _ => req,
    }
}

fn parse_rpc_result(
    body: &str,
    success_code: &'static str,
    fallback_error_code: &'static str,
    fallback_error_message: &'static str,
) -> Result<(bool, String, String, Value), AuthError> {
    let payload: Value = serde_json::from_str(body).map_err(|_| {
        AuthError::new(
            CODE_PARSE_ERROR,
            format!("Invalid server response: {}", body),
        )
    })?;

    let success = payload
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let message = payload
        .get("message")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
        .unwrap_or(if success { "OK" } else { fallback_error_message })
        .to_string();

    let code = payload
        .get("code")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
        .map(|v| v.to_string())
        .unwrap_or_else(|| {
            if success {
                success_code.to_string()
            } else {
                fallback_error_code.to_string()
            }
        });

    Ok((success, code, message, payload))
}

fn to_error_devices_response(err: AuthError) -> Value {
    json!({
        "success": false,
        "code": err.code,
        "message": err.message,
        "devices": []
    })
}

async fn sync_activation_status_to_admin(
    api_url: &str,
    api_token: Option<&str>,
    license_key: &str,
    machine_id: &str,
) {
    let redeem_url = match derive_rpc_url(api_url, "redeem_activation_code") {
        Ok(v) => v,
        Err(_) => return,
    };

    let client = Client::new();
    let req = with_auth_headers(client.post(&redeem_url), api_token);

    let response = match req
        .json(&json!({
            "p_code": license_key,
            "p_bound_device_id": machine_id
        }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return,
    };

    let body = response.text().await.unwrap_or_default();
    let payload: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return,
    };

    let first = payload
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|v| v.as_object());

    let ok = first
        .and_then(|obj| obj.get("ok"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if ok {
        return;
    }

    // Non-fatal: if already used, status is already synchronized.
    let msg = first
        .and_then(|obj| obj.get("message"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_lowercase();
    if msg.contains("已被使用") || msg.contains("already") || msg.contains("used") {
        return;
    }
}

#[tauri::command]
pub fn check_license_status() -> ActivationResult {
    let path = get_secure_config_path();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut config = if path.exists() {
        read_secure_config(&path, now).unwrap_or_else(|| SecureConfig::empty(now))
    } else {
        let cfg = SecureConfig::empty(now);
        write_secure_config(&path, &cfg);
        cfg
    };

    if config.is_activated {
        let valid_key = config.license_key.as_deref().and_then(normalize_license_key);
        let valid_url = config
            .api_url
            .as_ref()
            .map(|u| !u.trim().is_empty())
            .unwrap_or(false);

        if valid_key.is_none() || !valid_url {
            config.is_activated = false;
            config.license_key = None;
            write_secure_config(&path, &config);
        } else {
            let key = valid_key.unwrap_or_default();
            let key_for_remote_check = key.clone();
            let url = config.api_url.clone().unwrap_or_default();
            let token = config.api_token.clone();
            let mut activation_type = config.activation_type.clone();
            let mut expires_at = config.expires_at.clone();

            if activation_type.is_none() || (matches!(activation_type.as_deref(), Some("month" | "year")) && expires_at.is_none()) {
                if let Ok(verify_url) = derive_rpc_url(&url, "verify_license") {
                    let machine_id = get_machine_id();
                    let client = BlockingClient::new();
                    let req = with_auth_headers_blocking(client.post(&verify_url), token.as_deref());

                    if let Ok(response) = req
                        .json(&json!({
                            "p_key": key,
                            "p_device_id": machine_id
                        }))
                        .send()
                    {
                        if response.status().is_success() {
                            if let Ok(body) = response.text() {
                                if let Ok((success, _, _, payload)) = parse_rpc_result(
                                    &body,
                                    CODE_LICENSE_VERIFIED,
                                    CODE_VERIFY_FAILED,
                                    "License verify failed",
                                ) {
                                    if success {
                                        let (fresh_type, fresh_expires) = extract_license_meta(&payload);
                                        if fresh_type.is_some() {
                                            activation_type = fresh_type;
                                        }
                                        if fresh_expires.is_some() {
                                            expires_at = fresh_expires;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if activation_type != config.activation_type || expires_at != config.expires_at {
                    config.activation_type = activation_type.clone();
                    config.expires_at = expires_at.clone();
                    write_secure_config(&path, &config);
                }
            }

            if matches!(activation_type.as_deref(), Some("month" | "year")) {
                if let Some(expire_text) = expires_at.as_deref() {
                    if let Ok(expire_at) = DateTime::parse_from_rfc3339(expire_text) {
                        if expire_at.with_timezone(&Utc) <= Utc::now() {
                            config.is_activated = false;
                            config.license_key = None;
                            config.activation_type = None;
                            config.expires_at = None;
                            write_secure_config(&path, &config);
                            return ActivationResult::error(CODE_TRIAL_EXPIRED, "License Expired");
                        }
                    }
                }
            }

            tauri::async_runtime::spawn(async move {
                let verify_url = match derive_rpc_url(&url, "verify_license") {
                    Ok(u) => u,
                    Err(_) => return,
                };

                let client = Client::new();
                let req = with_auth_headers(client.post(&verify_url), token.as_deref());
                let machine_id = get_machine_id();

                let res = req
                    .json(&json!({
                        "p_key": key_for_remote_check,
                        "p_device_id": machine_id
                    }))
                    .send()
                    .await;

                let response = match res {
                    Ok(r) => r,
                    Err(_) => return,
                };

                let body = match response.text().await {
                    Ok(text) => text,
                    Err(_) => return,
                };

                if let Ok((success, _, _, payload)) = parse_rpc_result(
                    &body,
                    CODE_LICENSE_VERIFIED,
                    CODE_VERIFY_FAILED,
                    "License verify failed",
                ) {
                    let path = get_secure_config_path();
                    if let Some(mut cfg) = read_secure_config(&path, 0) {
                        if !success {
                            cfg.is_activated = false;
                            cfg.license_key = None;
                            cfg.activation_type = None;
                            cfg.expires_at = None;
                            write_secure_config(&path, &cfg);
                        } else {
                            let (activation_type, expires_at) = extract_license_meta(&payload);
                            if activation_type.is_some() {
                                cfg.activation_type = activation_type;
                            }
                            if expires_at.is_some() {
                                cfg.expires_at = expires_at;
                            }
                            write_secure_config(&path, &cfg);
                        }
                    }
                }
            });

            return ActivationResult::success(
                CODE_LICENSE_ACTIVE,
                "Pro Version",
                Some(LicenseInfo {
                    key,
                    device_id: get_machine_id(),
                    activation_type,
                    expires_at,
                }),
            );
        }
    }

    let elapsed = now.saturating_sub(config.first_run);
    if elapsed < 5_184_000 {
        return ActivationResult::success(
            CODE_TRIAL_ACTIVE,
            format!("Trial Mode ({} days left)", 60 - elapsed / 86_400),
            None,
        );
    }

    ActivationResult::error(CODE_TRIAL_EXPIRED, "Trial Expired")
}

#[tauri::command]
pub async fn verify_license(
    key: String,
    api_url: String,
    api_token: Option<String>,
) -> Result<ActivationResult, String> {
    let clean_key = match resolve_license_key(&key, LicenseKeyPolicy::ExplicitOnly) {
        Ok(v) => v,
        Err(err) => return Ok(ActivationResult::error(err.code, err.message)),
    };

    let verify_url = match derive_rpc_url(&api_url, "verify_license") {
        Ok(v) => v,
        Err(err) => return Ok(ActivationResult::error(err.code, err.message)),
    };

    let machine_id = get_machine_id();
    let client = Client::new();
    let req = with_auth_headers(client.post(&verify_url), api_token.as_deref());

    let res = req
        .json(&json!({
            "p_key": clean_key,
            "p_device_id": machine_id
        }))
        .send()
        .await;

    let response = match res {
        Ok(r) => r,
        Err(e) => {
            return Ok(ActivationResult::error(
                CODE_NETWORK_ERROR,
                format!("Network Request Failed: {}", e),
            ))
        }
    };

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Ok(ActivationResult::error(
            CODE_HTTP_ERROR,
            format!("Verify HTTP {}: {}", status, body),
        ));
    }

    let (success, code, message, payload) = match parse_rpc_result(
        &body,
        CODE_LICENSE_VERIFIED,
        CODE_VERIFY_FAILED,
        "Verify failed",
    ) {
        Ok(v) => v,
        Err(err) => return Ok(ActivationResult::error(err.code, err.message)),
    };

    if !success {
        return Ok(ActivationResult::error(code, message));
    }

    // Keep admin dashboard status in sync with desktop activation.
    sync_activation_status_to_admin(
        &verify_url,
        api_token.as_deref(),
        &clean_key,
        &machine_id,
    )
    .await;

    let path = get_secure_config_path();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut config = if path.exists() {
        read_secure_config(&path, now).unwrap_or_else(|| SecureConfig::empty(now))
    } else {
        SecureConfig::empty(now)
    };

    config.is_activated = true;
    config.license_key = Some(clean_key.clone());
    config.api_url = Some(verify_url);
    config.api_token = api_token;
    let (activation_type, expires_at) = extract_license_meta(&payload);
    config.activation_type = activation_type.clone();
    config.expires_at = expires_at.clone();
    write_secure_config(&path, &config);

    Ok(ActivationResult::success(
        code,
        message,
        Some(LicenseInfo {
            key: clean_key,
            device_id: machine_id,
            activation_type,
            expires_at,
        }),
    ))
}

#[tauri::command]
pub async fn unbind_license(
    key: String,
    api_url: String,
    api_token: Option<String>,
    target_device_id: String,
) -> Result<ActivationResult, String> {
    let clean_key = match resolve_license_key(&key, LicenseKeyPolicy::ExplicitOnly) {
        Ok(v) => v,
        Err(err) => return Ok(ActivationResult::error(err.code, err.message)),
    };

    if target_device_id.trim().is_empty() {
        return Ok(ActivationResult::error(
            CODE_INVALID_REQUEST,
            "Target device id is required.",
        ));
    }

    let unbind_url = match derive_rpc_url(&api_url, "unbind_license") {
        Ok(v) => v,
        Err(err) => return Ok(ActivationResult::error(err.code, err.message)),
    };

    let client = Client::new();
    let req = with_auth_headers(client.post(&unbind_url), api_token.as_deref());

    let res = req
        .json(&json!({
            "p_key": clean_key,
            "p_device_id": target_device_id
        }))
        .send()
        .await;

    let response = match res {
        Ok(r) => r,
        Err(e) => {
            return Ok(ActivationResult::error(
                CODE_NETWORK_ERROR,
                format!("Network Request Failed: {}", e),
            ))
        }
    };

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Ok(ActivationResult::error(
            CODE_HTTP_ERROR,
            format!("Unbind HTTP {}: {}", status, body),
        ));
    }

    let (success, code, message, _) = match parse_rpc_result(
        &body,
        CODE_LICENSE_UNBOUND,
        CODE_UNBIND_FAILED,
        "Unbind failed",
    ) {
        Ok(v) => v,
        Err(err) => return Ok(ActivationResult::error(err.code, err.message)),
    };

    if success {
        Ok(ActivationResult::success(code, message, None))
    } else {
        Ok(ActivationResult::error(code, message))
    }
}

#[tauri::command]
pub async fn get_license_devices(
    key: String,
    api_url: String,
    api_token: Option<String>,
) -> Result<Value, String> {
    let clean_key = match resolve_license_key(&key, LicenseKeyPolicy::ExplicitOrStored) {
        Ok(v) => v,
        Err(err) => return Ok(to_error_devices_response(err)),
    };

    let list_url = match derive_rpc_url(&api_url, "get_license_devices") {
        Ok(v) => v,
        Err(err) => return Ok(to_error_devices_response(err)),
    };

    let client = Client::new();
    let req = with_auth_headers(client.post(&list_url), api_token.as_deref());

    let res = req.json(&json!({ "p_key": clean_key })).send().await;

    let response = match res {
        Ok(r) => r,
        Err(e) => {
            return Ok(to_error_devices_response(AuthError::new(
                CODE_NETWORK_ERROR,
                format!("Network Request Failed: {}", e),
            )))
        }
    };

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Ok(to_error_devices_response(AuthError::new(
            CODE_HTTP_ERROR,
            format!("Get devices HTTP {}: {}", status, body),
        )));
    }

    let (success, code, message, payload) = match parse_rpc_result(
        &body,
        CODE_LICENSE_DEVICES_FETCHED,
        CODE_GET_DEVICES_FAILED,
        "Get devices failed",
    ) {
        Ok(v) => v,
        Err(err) => return Ok(to_error_devices_response(err)),
    };

    if let Some(mut map) = payload.as_object().cloned() {
        map.insert("success".to_string(), json!(success));
        map.insert("code".to_string(), json!(code));
        map.insert("message".to_string(), json!(message));
        if !map.contains_key("devices") {
            map.insert("devices".to_string(), json!([]));
        }
        return Ok(Value::Object(map));
    }

    Ok(json!({
        "success": success,
        "code": code,
        "message": message,
        "devices": [],
        "raw": payload
    }))
}
