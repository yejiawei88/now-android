use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const DISCOVERY_PORT: u16 = 27183;
const BROADCAST_INTERVAL_SECS: u64 = 5;

/// 启动 UDP 广播（电脑端每5秒广播自身存在）
pub fn start_discovery(
    device_name: String,
    http_port: u16,
    running: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        // 尝试获取本机局域网IP
        let local_ip = get_local_ip().unwrap_or_else(|| "0.0.0.0".to_string());

        let socket = match UdpSocket::bind("0.0.0.0:0") {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[Discovery] Failed to bind UDP socket: {}", e);
                return;
            }
        };

        if let Err(e) = socket.set_broadcast(true) {
            eprintln!("[Discovery] Failed to enable broadcast: {}", e);
            return;
        }

        let payload = serde_json::json!({
            "device": "NOW_PC",
            "ip": local_ip,
            "port": http_port,
            "name": device_name,
        })
        .to_string();

        let broadcast_addr = format!("255.255.255.255:{}", DISCOVERY_PORT);

        eprintln!("[Discovery] Broadcasting as '{}' on {}", device_name, broadcast_addr);

        while running.load(Ordering::Relaxed) {
            if let Err(e) = socket.send_to(payload.as_bytes(), &broadcast_addr) {
                eprintln!("[Discovery] Broadcast error: {}", e);
            }
            std::thread::sleep(std::time::Duration::from_secs(BROADCAST_INTERVAL_SECS));
        }

        eprintln!("[Discovery] Stopped.");
    });
}

/// 启动 UDP 监听（Android端监听广播，发现电脑端）
/// 返回一个接收器，前端通过 Tauri event 获得发现的设备列表
pub fn start_listener(
    running: Arc<AtomicBool>,
    on_discovered: impl Fn(String, String, u16) + Send + 'static,
) {
    std::thread::spawn(move || {
        let socket = match UdpSocket::bind(format!("0.0.0.0:{}", DISCOVERY_PORT)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[Discovery] Failed to bind listener UDP: {}", e);
                return;
            }
        };

        socket.set_read_timeout(Some(std::time::Duration::from_secs(2))).ok();

        let mut buf = [0u8; 1024];

        eprintln!("[Discovery] Listening for broadcasts on port {}", DISCOVERY_PORT);

        while running.load(Ordering::Relaxed) {
            match socket.recv_from(&mut buf) {
                Ok((len, _addr)) => {
                    if let Ok(payload_str) = std::str::from_utf8(&buf[..len]) {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(payload_str) {
                            if v["device"].as_str() == Some("NOW_PC") {
                                let ip = v["ip"].as_str().unwrap_or("").to_string();
                                let name = v["name"].as_str().unwrap_or("Unknown").to_string();
                                let port = v["port"].as_u64().unwrap_or(27182) as u16;
                                on_discovered(ip, name, port);
                            }
                        }
                    }
                }
                Err(_) => {} // timeout, loop again
            }
        }

        eprintln!("[Discovery] Listener stopped.");
    });
}

pub fn stop_discovery(running: &Arc<AtomicBool>) {
    running.store(false, Ordering::Relaxed);
}

/// 获取本机局域网 IP（优先选非127.0.0.1的IPv4地址）
fn get_local_ip() -> Option<String> {
    // 通过连接一个外部地址（不真正发送数据）来获得路由选择后的本机IP
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}
