use std::sync::{Mutex, Arc};
use std::time::Duration;
use std::io::{Read, Write};
use std::net::TcpStream;
use tauri::{State, async_runtime};
use base64::{self, Engine};

pub struct TerminalState(pub Arc<Mutex<Option<SessionData>>>);

pub struct SessionData {
    channel: ssh2::Channel,
    sftp: ssh2::Sftp,
    output_buffer: Arc<Mutex<String>>,
    last_read_pos: Arc<Mutex<usize>>,
}

fn clean_output(output: &str) -> String {
    let re1 = regex::Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap();
    let re2 = regex::Regex::new(r"\x1b\][0-9;]*[^\x07]*\x07").unwrap();
    let re3 = regex::Regex::new(r"\x1b[\[\]()][0-9;]*[a-zA-Z]?").unwrap();
    let re4 = regex::Regex::new(r"[\x00-\x08\x0b\x0c\x0e-\x1f]").unwrap();
    let re5 = regex::Regex::new(r"\x1b[^\x1b]*\x1b\\").unwrap();
    let re6 = regex::Regex::new(r"\?[0-9]+h").unwrap();
    
    let mut result = output.to_string();
    result = re5.replace_all(&result, "").to_string();
    result = re6.replace_all(&result, "").to_string();
    result = re2.replace_all(&result, "").to_string();
    result = re3.replace_all(&result, "").to_string();
    result = re1.replace_all(&result, "").to_string();
    result = re4.replace_all(&result, "").to_string();
    result = result.replace("\r\n", "\n").replace("\r", "\n");
    
    result
}

fn read_until_prompt(channel: &mut ssh2::Channel, buffer: &mut String, timeout: Duration) -> String {
    let start = std::time::Instant::now();
    let mut new_content = String::new();
    
    while start.elapsed() < timeout {
        let mut buf = [0; 4096];
        match channel.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let text = String::from_utf8_lossy(&buf[..n]).to_string();
                new_content.push_str(&text);
                buffer.push_str(&text);
                
                if new_content.contains("~]$") || new_content.contains("bash-") || 
                   new_content.contains("[root@") || new_content.contains("Opt>") ||
                   new_content.contains("]$") || new_content.contains("# ") {
                    break;
                }
            }
            Err(_) => break,
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    
    new_content
}

#[tauri::command]
pub async fn terminal_connect(
    state: State<'_, TerminalState>,
    host: String,
    port: i64,
    username: String,
    password: String,
) -> Result<String, String> {
    let state_clone = state.0.clone();
    
    let result = async_runtime::spawn_blocking(move || {
        let mut state_guard = state_clone.lock().map_err(|e| e.to_string())?;
        
        if state_guard.is_some() {
            return Err("已有连接存在，请先断开".to_string());
        }

        let tcp = TcpStream::connect((&host[..], port as u16))
            .map_err(|e| format!("连接失败: {}", e))?;

        let mut sess = ssh2::Session::new().map_err(|e| format!("创建会话失败: {}", e))?;
        sess.set_tcp_stream(tcp);
        sess.handshake().map_err(|e| format!("握手失败: {}", e))?;
        sess.userauth_password(&username, &password)
            .map_err(|e| format!("认证失败: {}", e))?;

        if !sess.authenticated() {
            return Err("认证失败".to_string());
        }

        let mut channel = sess.channel_session()
            .map_err(|e| format!("创建通道失败: {}", e))?;
        channel.request_pty("xterm", None, None)
            .map_err(|e| format!("请求PTY失败: {}", e))?;
        channel.shell()
            .map_err(|e| format!("启动shell失败: {}", e))?;

        let output_buffer = Arc::new(Mutex::new(String::new()));
        let buffer_clone = output_buffer.clone();
        
        std::thread::sleep(Duration::from_millis(1000));
        
        let mut buffer = String::new();
        let mut output = read_until_prompt(&mut channel, &mut buffer, Duration::from_secs(5));
        
        if output.contains("Opt>") {
            channel.write_all(b"1\r").map_err(|e| format!("发送命令失败: {}", e))?;
            channel.flush().map_err(|e| format!("刷新失败: {}", e))?;
            std::thread::sleep(Duration::from_millis(500));
            output += &read_until_prompt(&mut channel, &mut buffer, Duration::from_secs(5));
            
            if output.contains("Opt>") {
                channel.write_all(b"1\r").map_err(|e| format!("发送命令失败: {}", e))?;
                channel.flush().map_err(|e| format!("刷新失败: {}", e))?;
                std::thread::sleep(Duration::from_millis(2000));
                output += &read_until_prompt(&mut channel, &mut buffer, Duration::from_secs(5));
            }
        }

        let sftp = sess.sftp().map_err(|e| format!("创建SFTP失败: {}", e))?;

        let last_read_pos = Arc::new(Mutex::new(buffer.len()));
        {
            let mut buf_guard = buffer_clone.lock().unwrap();
            *buf_guard = buffer;
        }

        state_guard.replace(SessionData {
            channel,
            sftp,
            output_buffer,
            last_read_pos,
        });

        Ok(clean_output(&output))
    }).await;

    match result {
        Ok(inner) => inner,
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn terminal_send(
    state: State<'_, TerminalState>,
    command: String,
) -> Result<String, String> {
    let state_clone = state.0.clone();
    
    let result = async_runtime::spawn_blocking(move || {
        let mut state_guard = state_clone.lock().map_err(|e| e.to_string())?;
        
        let conn = state_guard.as_mut()
            .ok_or("未连接到服务器".to_string())?;

        conn.channel.write_all(format!("{}\r", command).as_bytes())
            .map_err(|e| format!("发送命令失败: {}", e))?;

        conn.channel.flush()
            .map_err(|e| format!("刷新失败: {}", e))?;

        std::thread::sleep(Duration::from_millis(500));

        let cleaned = {
            let mut buffer = conn.output_buffer.lock().unwrap();
            let mut last_pos_guard = conn.last_read_pos.lock().unwrap();
            let last_pos = *last_pos_guard;
            
            let mut new_content = String::new();
            let mut buf = [0; 4096];
            let start = std::time::Instant::now();
            
            loop {
                match conn.channel.read(&mut buf) {
                    Ok(0) => {
                        if start.elapsed() > Duration::from_millis(800) {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        new_content.push_str(&text);
                        buffer.push_str(&text);
                        if new_content.contains("~]$") || new_content.contains("]$") || 
                           new_content.contains("[root@") || new_content.contains("[dev@") {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => {
                        if start.elapsed() > Duration::from_millis(800) {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                }
            }
            
            *last_pos_guard = buffer.len();
            clean_output(&new_content)
        };
        
        Ok(cleaned)
    }).await;

    match result {
        Ok(inner) => inner,
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn terminal_disconnect(
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let mut state_guard = state.0.lock().map_err(|e| e.to_string())?;
    
    if let Some(mut conn) = state_guard.take() {
        let _ = conn.channel.close();
    }
    
    Ok(())
}

#[tauri::command]
pub fn terminal_is_connected(
    state: State<'_, TerminalState>,
) -> Result<bool, String> {
    let state_guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(state_guard.is_some())
}

#[tauri::command]
pub async fn terminal_list_files(
    state: State<'_, TerminalState>,
    path: String,
) -> Result<String, String> {
    let state_clone = state.0.clone();
    
    let result = async_runtime::spawn_blocking(move || {
        let mut state_guard = state_clone.lock().map_err(|e| e.to_string())?;
        
        let conn = state_guard.as_mut()
            .ok_or("未连接到服务器".to_string())?;

        let cmd = format!("ls -la {} 2>/dev/null || ls {}", path, path);
        conn.channel.write_all(format!("{}\r", cmd).as_bytes())
            .map_err(|e| format!("发送命令失败: {}", e))?;

        conn.channel.flush()
            .map_err(|e| format!("刷新失败: {}", e))?;

        std::thread::sleep(Duration::from_millis(1000));

        let cleaned = {
            let mut buffer = conn.output_buffer.lock().unwrap();
            let mut last_pos_guard = conn.last_read_pos.lock().unwrap();
            let last_pos = *last_pos_guard;
            
            let mut new_content = String::new();
            let mut buf = [0; 4096];
            loop {
                match conn.channel.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        new_content.push_str(&text);
                        buffer.push_str(&text);
                    }
                    Err(_) => break,
                }
            }
            
            *last_pos_guard = buffer.len();
            clean_output(&new_content)
        };
        
        Ok(cleaned)
    }).await;

    match result {
        Ok(inner) => inner,
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn terminal_file_info(
    state: State<'_, TerminalState>,
    file_path: String,
) -> Result<String, String> {
    let state_clone = state.0.clone();
    
    let result = async_runtime::spawn_blocking(move || {
        let mut state_guard = state_clone.lock().map_err(|e| e.to_string())?;
        
        let conn = state_guard.as_mut()
            .ok_or("未连接到服务器".to_string())?;

        let cmd = format!("stat -c '%s %y' '{}' 2>/dev/null || ls -la '{}' 2>/dev/null", file_path, file_path);
        conn.channel.write_all(format!("{}\r", cmd).as_bytes())
            .map_err(|e| format!("发送命令失败: {}", e))?;

        conn.channel.flush()
            .map_err(|e| format!("刷新失败: {}", e))?;

        std::thread::sleep(Duration::from_millis(800));

        let cleaned = {
            let mut buffer = conn.output_buffer.lock().unwrap();
            let mut last_pos_guard = conn.last_read_pos.lock().unwrap();
            
            let mut new_content = String::new();
            let mut buf = [0; 4096];
            let start = std::time::Instant::now();
            
            loop {
                match conn.channel.read(&mut buf) {
                    Ok(0) => {
                        if start.elapsed() > Duration::from_millis(600) {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        new_content.push_str(&text);
                        buffer.push_str(&text);
                        if new_content.contains("]$") || new_content.contains("[root@") || 
                           new_content.contains("[dev@") {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => {
                        if start.elapsed() > Duration::from_millis(600) {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                }
            }
            
            *last_pos_guard = buffer.len();
            clean_output(&new_content)
        };
        
        Ok(cleaned)
    }).await;

    match result {
        Ok(inner) => inner,
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn terminal_upload_file(
    state: State<'_, TerminalState>,
    local_path: String,
    remote_path: String,
    _host: String,
    _username: String,
    _password: String,
    _port: i64,
) -> Result<String, String> {
    let state_clone = state.0.clone();
    
    let result = async_runtime::spawn_blocking(move || {
        let mut state_guard = state_clone.lock().map_err(|e| e.to_string())?;
        
        let conn = state_guard.as_mut()
            .ok_or("未连接到服务器".to_string())?;

        let filename = local_path.split('/').last().unwrap_or(&local_path);
        let full_remote_path = format!("{}/{}", remote_path.trim_end_matches('/'), filename);

        let file_content = std::fs::read(&local_path)
            .map_err(|e| format!("读取本地文件失败: {}", e))?;

        let chunks: Vec<String> = file_content.as_slice().chunks(8192)
            .map(|c| String::from_utf8_lossy(c).to_string())
            .collect();

        let mkdir_cmd = format!("mkdir -p {}\r", remote_path);
        conn.channel.write_all(mkdir_cmd.as_bytes())
            .map_err(|e| format!("发送mkdir命令失败: {}", e))?;
        conn.channel.flush()
            .map_err(|e| format!("刷新失败: {}", e))?;
        std::thread::sleep(std::time::Duration::from_millis(300));

        let base64_content = base64::engine::general_purpose::STANDARD.encode(&file_content);
        let chunk_size = 80;
        let base64_chunks: Vec<String> = base64_content.as_str().chars()
            .collect::<Vec<_>>()
            .chunks(chunk_size)
            .map(|c| c.iter().collect::<String>())
            .collect();

        let init_cmd = format!("echo -n '' > {}.b64\r", full_remote_path);
        conn.channel.write_all(init_cmd.as_bytes())
            .map_err(|e| format!("发送初始化命令失败: {}", e))?;
        conn.channel.flush()
            .map_err(|e| format!("刷新失败: {}", e))?;
        std::thread::sleep(std::time::Duration::from_millis(200));

        for (i, chunk) in base64_chunks.iter().enumerate() {
            let append_cmd = format!("echo -n '{}' >> {}.b64\r", chunk, full_remote_path);
            conn.channel.write_all(append_cmd.as_bytes())
                .map_err(|e| format!("发送块 {} 失败: {}", i, e))?;
            conn.channel.flush()
                .map_err(|e| format!("刷新失败: {}", e))?;
            
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        std::thread::sleep(std::time::Duration::from_millis(300));

        let decode_cmd = format!("base64 -d {}.b64 > {} && rm {}.b64\r", full_remote_path, full_remote_path, full_remote_path);
        conn.channel.write_all(decode_cmd.as_bytes())
            .map_err(|e| format!("发送解码命令失败: {}", e))?;
        conn.channel.flush()
            .map_err(|e| format!("刷新失败: {}", e))?;

        std::thread::sleep(std::time::Duration::from_millis(1500));

        let cleaned = {
            let mut buffer = conn.output_buffer.lock().unwrap();
            let mut last_pos_guard = conn.last_read_pos.lock().unwrap();
            let last_pos = *last_pos_guard;
            
            let mut new_content = String::new();
            let mut buf = [0; 4096];
            loop {
                match conn.channel.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        new_content.push_str(&text);
                        buffer.push_str(&text);
                    }
                    Err(_) => break,
                }
            }
            
            *last_pos_guard = buffer.len();
            clean_output(&new_content)
        };

        if cleaned.contains("No such file or directory") || cleaned.contains("Permission denied") || cleaned.contains("base64:") {
            Err(format!("上传失败: {}", cleaned))
        } else {
            Ok(format!("上传成功: {}", full_remote_path))
        }
    }).await;

    match result {
        Ok(inner) => inner,
        Err(e) => Err(e.to_string()),
    }
}