use std::sync::{Mutex, Arc};
use std::time::Duration;
use std::io::{Read, Write};
use tauri::{State, async_runtime};

pub struct TerminalState(pub Arc<Mutex<Option<SessionData>>>);

pub struct SessionData {
    stdin: std::process::ChildStdin,
    process: std::process::Child,
    output_buffer: Arc<Mutex<String>>,
    last_read_pos: Arc<Mutex<usize>>,
}

fn clean_output(output: &str) -> String {
    let re1 = regex::Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap();
    let re2 = regex::Regex::new(r"\x1b\][0-9;]*[^\x07]*\x07").unwrap();
    let re3 = regex::Regex::new(r"\x1b[\[\]()][0-9;]*[a-zA-Z]?").unwrap();
    let re4 = regex::Regex::new(r"[\x00-\x08\x0b\x0c\x0e-\x1f]").unwrap();
    
    let mut result = output.to_string();
    result = re2.replace_all(&result, "").to_string();
    result = re3.replace_all(&result, "").to_string();
    result = re1.replace_all(&result, "").to_string();
    result = re4.replace_all(&result, "").to_string();
    result = result.replace("\r\n", "\n").replace("\r", "\n");
    
    result
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

        let expect_script = format!(
            "set timeout 15\n\
             spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o HostKeyAlgorithms=+ssh-rsa {}@{} -p {}\n\
             expect \"*password:*\"\n\
             send \"{}\\r\"\n\
             sleep 1\n\
             send \"1\\r\"\n\
             expect \"Opt>\"\n\
             send \"1\\r\"\n\
             expect {{\n\
                 \"~]$\" {{}}\n\
                 \"bash-*\" {{}}\n\
                 \"[root@*\" {{}}\n\
                 \"*@* ~]$\" {{}}\n\
                 \"*@* ~]$\" {{}}\n\
                 timeout {{ exit 1 }}\n\
             }}\n\
             interact",
            username, host, port, password
        );

        let temp_file = tempfile::NamedTempFile::new()
            .map_err(|e| format!("Failed to create temp file: {}", e))?;

        std::fs::write(temp_file.path(), &expect_script)
            .map_err(|e| format!("Failed to write expect script: {}", e))?;

        let mut child = std::process::Command::new("expect")
            .arg(temp_file.path())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn expect: {}", e))?;

        let stdin = child.stdin.take()
            .ok_or("Failed to get stdin")?;

        let stdout = child.stdout.take()
            .ok_or("Failed to get stdout")?;

        let output_buffer = Arc::new(Mutex::new(String::new()));
        let last_read_pos = Arc::new(Mutex::new(0));
        let buffer_clone = output_buffer.clone();
        
        std::thread::spawn(move || {
            let mut reader = stdout;
            let mut buf = [0; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        let mut buffer = buffer_clone.lock().unwrap();
                        buffer.push_str(&text);
                    }
                    Err(_) => break,
                }
            }
        });

        std::thread::sleep(Duration::from_secs(5));

        let cleaned = {
            let buffer = output_buffer.lock().unwrap();
            let mut last_pos_guard = last_read_pos.lock().unwrap();
            let last_pos = *last_pos_guard;
            let new_content = &buffer[last_pos..];
            *last_pos_guard = buffer.len();
            clean_output(new_content)
        };

        let status = child.try_wait().map_err(|e| format!("检查进程状态失败: {}", e))?;
        if status.is_some() {
            let code = status.unwrap().code().unwrap_or(-1);
            return Err(format!("连接进程已退出，代码: {}", code));
        }

        state_guard.replace(SessionData {
            stdin,
            process: child,
            output_buffer,
            last_read_pos,
        });

        Ok(cleaned)
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

        conn.stdin.write_all(format!("{}\r", command).as_bytes())
            .map_err(|e| format!("发送命令失败: {}", e))?;

        conn.stdin.flush()
            .map_err(|e| format!("刷新失败: {}", e))?;

        std::thread::sleep(Duration::from_millis(800));

        let cleaned = {
            let buffer = conn.output_buffer.lock().unwrap();
            let mut last_pos_guard = conn.last_read_pos.lock().unwrap();
            let last_pos = *last_pos_guard;
            let new_content = &buffer[last_pos..];
            *last_pos_guard = buffer.len();
            clean_output(new_content)
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
        let _ = conn.process.kill();
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
        conn.stdin.write_all(format!("{}\r", cmd).as_bytes())
            .map_err(|e| format!("发送命令失败: {}", e))?;

        conn.stdin.flush()
            .map_err(|e| format!("刷新失败: {}", e))?;

        std::thread::sleep(Duration::from_millis(800));

        let cleaned = {
            let buffer = conn.output_buffer.lock().unwrap();
            let mut last_pos_guard = conn.last_read_pos.lock().unwrap();
            let last_pos = *last_pos_guard;
            let new_content = &buffer[last_pos..];
            *last_pos_guard = buffer.len();
            clean_output(new_content)
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
    host: String,
    username: String,
    password: String,
    port: i64,
) -> Result<String, String> {
    let state_clone = state.0.clone();
    
    let result = async_runtime::spawn_blocking(move || {
        let state_guard = state_clone.lock().map_err(|e| e.to_string())?;
        
        let conn = state_guard.as_mut()
            .ok_or("未连接到服务器".to_string())?;

        let filename = local_path.split('/').last().unwrap_or(&local_path);
        let full_remote_path = format!("{}/{}", remote_path.trim_end_matches('/'), filename);

        let file_content = std::fs::read(&local_path)
            .map_err(|e| format!("读取本地文件失败: {}", e))?;
        
        let base64_content = base64::encode(&file_content);

        let cmd = format!("mkdir -p {} && echo '{}' | base64 -d > {}", remote_path, base64_content, full_remote_path);
        let cmd_bytes = format!("{}\r", cmd).as_bytes();
        
        conn.stdin.write_all(cmd_bytes)
            .map_err(|e| format!("发送命令失败: {}", e))?;
        
        conn.stdin.flush()
            .map_err(|e| format!("刷新失败: {}", e))?;

        std::thread::sleep(std::time::Duration::from_millis(1500));

        let cleaned = {
            let buffer = conn.output_buffer.lock().unwrap();
            let mut last_pos_guard = conn.last_read_pos.lock().unwrap();
            let last_pos = *last_pos_guard;
            let new_content = &buffer[last_pos..];
            *last_pos_guard = buffer.len();
            clean_output(new_content)
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