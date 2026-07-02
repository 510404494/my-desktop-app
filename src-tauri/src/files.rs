use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;
use tempfile::NamedTempFile;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceConfig {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub device_type: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(rename = "scanPaths")]
    pub scan_paths: Vec<String>,
    #[serde(rename = "lastOpenPath")]
    pub last_open_path: String,
}

pub struct ConfigState(pub Mutex<AppConfig>);

#[tauri::command]
pub async fn fetch_json_from_url(url: String) -> Result<serde_json::Value, String> {
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to fetch URL: {}", e))?;

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse JSON: {}", e))
}

#[tauri::command]
pub fn export_to_json(data: serde_json::Value, path: String) -> Result<(), String> {
    let content = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn export_to_csv(data: serde_json::Value, path: String) -> Result<(), String> {
    let mut csv = String::new();

    if let Some(obj) = data.as_object() {
        let keys: Vec<&str> = obj.keys().map(|s| s.as_str()).collect();
        csv.push_str(&keys.join(","));
        csv.push('\n');

        let values: Vec<String> = keys.iter().map(|k| {
            match obj.get(*k) {
                Some(serde_json::Value::String(s)) => format!("\"{}\"", s.replace('"', "\"\"")),
                Some(v) => v.to_string(),
                None => String::new(),
            }
        }).collect();
        csv.push_str(&values.join(","));
    }

    fs::write(&path, csv).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn scan_directory(path: String) -> Result<Vec<DeviceConfig>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err("Not a directory".to_string());
    }

    let mut devices = Vec::new();
    scan_json_files(dir, &mut devices, &path)?;
    Ok(devices)
}

fn scan_json_files(dir: &Path, devices: &mut Vec<DeviceConfig>, base_path: &str) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            scan_json_files(&path, devices, base_path)?;
        } else if path.extension().map_or(false, |ext| ext == "json") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(data) = serde_json::from_str::<serde_json::Value>(&content) {
                    let file_name = path.file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "Unknown".to_string());

                    let relative_path = path.strip_prefix(base_path)
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_else(|_| path.to_string_lossy().to_string());

                    let dir_name = path.parent()
                        .and_then(|p| p.file_name())
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "Uncategorized".to_string());

                    devices.push(DeviceConfig {
                        id: uuid::Uuid::new_v4().to_string(),
                        name: file_name,
                        device_type: dir_name,
                        file_path: relative_path,
                        data,
                    });
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn load_file(path: String) -> Result<DeviceConfig, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let data: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let file_name = Path::new(&path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    Ok(DeviceConfig {
        id: uuid::Uuid::new_v4().to_string(),
        name: file_name,
        device_type: "manual".to_string(),
        file_path: path,
        data,
    })
}

#[tauri::command]
pub fn save_device(file_path: String, data: serde_json::Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&file_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_config(state: State<ConfigState>) -> Result<AppConfig, String> {
    let config = state.0.lock().map_err(|e| e.to_string())?;
    Ok(config.clone())
}

#[tauri::command]
pub fn save_config(state: State<ConfigState>, scan_paths: Vec<String>) -> Result<(), String> {
    let mut config = state.0.lock().map_err(|e| e.to_string())?;
    config.scan_paths = scan_paths;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: String,
    pub is_dir: bool,
}

fn clean_ansi_escape(s: &str) -> String {
    let re = regex::Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap();
    re.replace_all(s, "").to_string()
}

fn execute_jumpserver_command(host: &str, port: i64, username: &str, password: &str, host_choice: &str, cmd: &str) -> Result<String, String> {
    let expect_script = format!(
        "set timeout 30\n\
         spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o HostKeyAlgorithms=+ssh-rsa {}@{} -p {}\n\
         expect \"*password:*\"\n\
         send \"{}\\n\"\n\
         expect {{\n\
             \"Opt>\" {{\n\
                 send \"{}\\n\"\n\
             }}\n\
             \"*欢迎*\" {{\n\
                 send \"{}\\n\"\n\
                 expect \"Opt>\"\n\
                 send \"{}\\n\"\n\
             }}\n\
         }}\n\
         expect {{\n\
             \"~]$\" {{}}\n\
             \"bash-*\" {{}}\n\
             \"[root@*\" {{}}\n\
             \"*@* ~]$\" {{}}\n\
         }}\n\
         send \"cd /data/apppic/newsmarthome\\n\"\n\
         expect {{\n\
             \"~]$\" {{}}\n\
             \"bash-*\" {{}}\n\
             \"[root@*\" {{}}\n\
             \"*@* ~]$\" {{}}\n\
         }}\n\
         send \"{}\\n\"\n\
         expect {{\n\
             \"~]$\" {{}}\n\
             \"bash-*\" {{}}\n\
             \"[root@*\" {{}}\n\
             \"*@* ~]$\" {{}}\n\
         }}\n\
         send \"exit\\n\"\n\
         expect eof",
        username, host, port, password, host_choice, host_choice, host_choice, cmd
    );
    
    let temp_file = tempfile::NamedTempFile::new()
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    
    fs::write(temp_file.path(), expect_script)
        .map_err(|e| format!("Failed to write expect script: {}", e))?;
    
    let output = std::process::Command::new("expect")
        .arg(temp_file.path())
        .output()
        .map_err(|e| format!("Failed to execute expect: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    
    if !output.status.success() {
        return Err(format!("Command failed: {}", stderr));
    }
    
    let combined = format!("{}\n{}", stdout, stderr);
    let cleaned = clean_ansi_escape(&combined);
    
    Ok(cleaned)
}

#[tauri::command]
pub fn list_server_files(
    host: String,
    port: i64,
    username: String,
    password: String,
    remotePath: String,
) -> Result<Vec<ServerFile>, String> {
    let cmd = format!("ls -la {}", remotePath);
    let output = execute_jumpserver_command(&host, port, &username, &password, "1", &cmd)?;
    
    let mut files = Vec::new();
    let mut in_ls_output = false;
    
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        
        if !in_ls_output {
            if trimmed.contains("Last login") || trimmed.starts_with("[dev@") || trimmed.starts_with("Opt") || trimmed.starts_with("欢迎") {
                continue;
            }
            if trimmed.starts_with("$") || trimmed.starts_with("]") || trimmed.starts_with(">") {
                continue;
            }
            if trimmed.starts_with("total") {
                in_ls_output = true;
                continue;
            }
            in_ls_output = true;
        }
        
        if trimmed.starts_with("$") || trimmed.starts_with("]") || trimmed.starts_with(">") {
            continue;
        }
        
        if trimmed.starts_with("total") {
            continue;
        }
        
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 9 {
            continue;
        }
        
        let permissions = parts[0];
        let is_dir = permissions.starts_with('d');
        let size: u64 = parts[4].parse().unwrap_or(0);
        let name_start = parts[0..8].join(" ").len() + 1;
        let name = &trimmed[name_start..].trim();
        
        if name.starts_with('.') {
            continue;
        }
        
        if !is_dir {
            let lower_name = name.to_lowercase();
            if !lower_name.ends_with(".png") && !lower_name.ends_with(".jpg") && !lower_name.ends_with(".jpeg") {
                continue;
            }
        }
        
        files.push(ServerFile {
            name: name.to_string(),
            path: format!("{}/{}", remotePath, name),
            size,
            modified: String::new(),
            is_dir,
        });
    }
    
    files.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            a.is_dir.cmp(&b.is_dir).reverse()
        } else {
            a.name.cmp(&b.name)
        }
    });
    
    Ok(files)
}

#[tauri::command]
pub fn download_server_file(
    host: String,
    port: i64,
    username: String,
    password: String,
    remotePath: String,
) -> Result<String, String> {
    let cmd = format!("cat {}", remotePath);
    let content = execute_jumpserver_command(&host, port, &username, &password, "1", &cmd)?;
    
    let mut temp_file = NamedTempFile::new()
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    
    temp_file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    
    let temp_path = temp_file.into_temp_path();
    let path_str = temp_path.to_string_lossy().to_string();
    
    Ok(path_str)
}

#[tauri::command]
pub fn read_server_file(
    host: String,
    port: i64,
    username: String,
    password: String,
    remotePath: String,
) -> Result<String, String> {
    let cmd = format!("cat {}", remotePath);
    let output = execute_jumpserver_command(&host, port, &username, &password, "1", &cmd)?;
    
    let mut content = String::new();
    let mut in_content = false;
    
    for line in output.lines() {
        let trimmed = line.trim();
        
        if trimmed.starts_with("~]$") || trimmed.starts_with("Opt>") || trimmed.starts_with("[dev@") {
            in_content = false;
            continue;
        }
        
        if trimmed.starts_with("wangchuan") || trimmed.contains("欢迎使用") || trimmed.contains("Last login") {
            continue;
        }
        
        if !in_content && trimmed.is_empty() {
            continue;
        }
        
        in_content = true;
        content.push_str(line);
        content.push('\n');
    }
    
    Ok(content.trim().to_string())
}

#[tauri::command]
pub fn execute_jumpserver_cmd(
    host: String,
    port: i64,
    username: String,
    password: String,
    command: String,
) -> Result<String, String> {
    let output = execute_jumpserver_command(&host, port, &username, &password, "1", &command)?;
    
    let mut content = String::new();
    let mut in_content = false;
    
    for line in output.lines() {
        let trimmed = line.trim();
        
        if trimmed.starts_with("~]$") || trimmed.starts_with("Opt>") || trimmed.starts_with("[dev@") {
            in_content = false;
            continue;
        }
        
        if trimmed.starts_with("wangchuan") || trimmed.contains("欢迎使用") || trimmed.contains("Last login") {
            continue;
        }
        
        if !in_content && trimmed.is_empty() {
            continue;
        }
        
        in_content = true;
        content.push_str(line);
        content.push('\n');
    }
    
    Ok(content.trim().to_string())
}

#[tauri::command]
pub fn test_server_connection(
    host: String,
    port: i64,
    username: String,
    password: String,
) -> Result<String, String> {
    let cmd = "echo \"Connection successful\"";
    let _output = execute_jumpserver_command(&host, port, &username, &password, "1", &cmd)?;
    
    Ok("连接成功！".to_string())
}
