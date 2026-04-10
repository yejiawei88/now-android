use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use rand::Rng;

/// 一次性PIN码，60秒有效
#[derive(Clone, Debug)]
pub struct PinEntry {
    pub pin: String,
    pub expires_at: u64, // unix timestamp secs
}

/// Session token，24小时有效
#[derive(Clone, Debug)]
pub struct TokenEntry {
    pub token: String,
    pub expires_at: u64,
    pub device_name: String,
}

#[derive(Clone)]
pub struct AuthStore {
    pub pins: Arc<Mutex<Option<PinEntry>>>,
    pub tokens: Arc<Mutex<HashMap<String, TokenEntry>>>,
}

impl AuthStore {
    pub fn new() -> Self {
        Self {
            pins: Arc::new(Mutex::new(None)),
            tokens: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 生成6位PIN码，60秒有效
    pub fn generate_pin(&self) -> String {
        let pin: String = rand::thread_rng()
            .sample_iter(rand::distributions::Uniform::new(0, 10))
            .take(6)
            .map(|d| d.to_string())
            .collect();

        let expires_at = now_secs() + 60;
        let entry = PinEntry {
            pin: pin.clone(),
            expires_at,
        };
        *self.pins.lock().unwrap() = Some(entry);
        pin
    }

    /// 设置用户自定义的6位PIN码（用于简化配对流程）
    pub fn set_pin(&self, pin: &str) -> Result<String, String> {
        // 验证：必须是6位数字
        if pin.len() != 6 || !pin.chars().all(|c| c.is_ascii_digit()) {
            return Err("PIN must be 6 digits".to_string());
        }
        
        let expires_at = now_secs() + 300; // 自定义 PIN 有效期5分钟
        let entry = PinEntry {
            pin: pin.to_string(),
            expires_at,
        };
        *self.pins.lock().unwrap() = Some(entry);
        Ok(pin.to_string())
    }

    /// 验证PIN，成功返回 session_token
    pub fn verify_pin(&self, pin: &str, device_name: &str) -> Option<String> {
        let guard = self.pins.lock().unwrap();
        if let Some(ref entry) = *guard {
            if entry.pin == pin && now_secs() < entry.expires_at {
                // PIN 匹配，生成 token
                drop(guard); // 先释放 pins 锁再获取 tokens 锁
                let token = self.create_token(device_name);
                // 清除 PIN（一次性）
                *self.pins.lock().unwrap() = None;
                return Some(token);
            }
        }
        None
    }

    fn create_token(&self, device_name: &str) -> String {
        let token: String = rand::thread_rng()
            .sample_iter(rand::distributions::Alphanumeric)
            .take(32)
            .map(char::from)
            .collect();

        let expires_at = now_secs() + 86400; // 24h
        let entry = TokenEntry {
            token: token.clone(),
            expires_at,
            device_name: device_name.to_string(),
        };
        self.tokens.lock().unwrap().insert(token.clone(), entry);
        token
    }

    /// 验证 token 是否有效
    pub fn verify_token(&self, token: &str) -> bool {
        let tokens = self.tokens.lock().unwrap();
        if let Some(entry) = tokens.get(token) {
            return now_secs() < entry.expires_at;
        }
        false
    }

    /// 获取当前有效的 PIN（供前端展示）
    pub fn current_pin(&self) -> Option<String> {
        let guard = self.pins.lock().unwrap();
        if let Some(ref entry) = *guard {
            if now_secs() < entry.expires_at {
                return Some(entry.pin.clone());
            }
        }
        None
    }

    /// 清除某个 token（断开连接）
    pub fn revoke_token(&self, token: &str) {
        self.tokens.lock().unwrap().remove(token);
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
