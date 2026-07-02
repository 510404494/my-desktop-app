# 服务器自动刷新列表功能实现计划

## 需求描述

用户希望添加服务器管理功能，能够：
1. 配置服务器连接信息（华为云 hw-jump-koko.mymlsoft.com:2222，用户名 wangchuan，密码 Wangchuan@12345）
2. 自动检查并刷新服务器上的文件列表
3. 支持从服务器加载 JSON 文件进行编辑

## 方案对比

### 方案一：SSH 连接
- 使用 Rust 的 `ssh2` crate 建立 SSH 连接
- 执行命令获取文件列表
- 下载文件到本地临时目录
- **优点**：直接访问服务器文件系统，兼容性强
- **缺点**：需要额外依赖，文件传输需要处理

### 方案二：HTTP API
- 服务器端提供文件列表和下载 API
- 通过 HTTP 请求获取数据
- **优点**：实现简单，无需 SSH 依赖
- **缺点**：需要服务器端配合部署 API

### 方案三：SFTP 协议
- 使用 SFTP 协议传输文件
- 通过 SSH 隧道建立连接
- **优点**：标准文件传输协议，稳定可靠
- **缺点**：依赖 SSH，配置较复杂

**选择方案一（SSH）**：用户已提供 SSH 登录信息，且可以直接执行命令获取文件列表。

## 步骤拆解

### 1. 数据模型设计

新增服务器配置数据结构：

```typescript
interface ServerConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  password: string
  remotePath: string
}
```

### 2. 后端实现（Rust）

在 `src-tauri/src/files.rs` 中添加：
- `ServerConfig` 结构体
- `list_server_files` 命令：SSH 连接服务器，列出指定目录下的 JSON 文件
- `download_server_file` 命令：下载服务器上的文件到本地临时目录

### 3. 前端实现（React）

在 `src/App.tsx` 中添加：
- 服务器管理面板（添加/编辑/删除服务器）
- 服务器文件列表展示
- 定时刷新功能（可配置刷新间隔）
- 从服务器打开文件进行编辑

### 4. 数据库存储

在 SQLite 中新增 `servers` 表存储服务器配置：

```sql
CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    remote_path TEXT NOT NULL,
    refresh_interval INTEGER DEFAULT 300
);
```

## 文件和模块修改

### 需要编辑的文件

1. **src-tauri/src/files.rs**
   - 添加 `ServerConfig` 结构体
   - 添加 SSH 连接和文件操作函数
   - 添加 Tauri 命令 `list_server_files`、`download_server_file`

2. **src-tauri/src/lib.rs**
   - 在 `invoke_handler` 中注册新命令

3. **src-tauri/src/db.rs**
   - 添加服务器配置的增删改查方法

4. **src/types/index.ts**
   - 添加 `ServerConfig` TypeScript 接口

5. **src/App.tsx**
   - 添加服务器管理界面
   - 添加定时刷新逻辑
   - 添加服务器文件列表展示

6. **src/App.css**
   - 添加服务器管理相关样式

### 需要新增的依赖

后端（Cargo.toml）：
- `ssh2` - SSH 客户端库
- `tempfile` - 临时文件处理

前端：无新增依赖

## 风险预判

1. **SSH 连接失败**：网络问题、认证失败、服务器不可达
   - 处理：添加重试机制，显示详细错误信息

2. **密码安全**：密码存储在数据库中未加密
   - 处理：使用加密存储或仅在内存中保存

3. **性能问题**：频繁刷新可能导致服务器负载过高
   - 处理：设置合理的默认刷新间隔（5分钟），可配置

4. **文件下载冲突**：多人同时编辑同一文件
   - 处理：添加文件版本检查，提示用户

## 优化细节

1. **连接池**：复用 SSH 连接，减少连接开销
2. **增量更新**：仅获取变化的文件，减少数据传输
3. **离线模式**：服务器不可达时使用本地缓存
4. **错误处理**：完善的错误提示和重试机制
5. **用户体验**：刷新时显示加载状态，添加刷新按钮

## 实施计划

| 步骤 | 内容 | 状态 |
|------|------|------|
| 1 | 添加后端依赖（ssh2, tempfile） | 待开发 |
| 2 | 在数据库中创建 servers 表 | 待开发 |
| 3 | 实现后端服务器管理命令 | 待开发 |
| 4 | 实现后端 SSH 文件列表和下载功能 | 待开发 |
| 5 | 添加前端服务器管理界面 | 待开发 |
| 6 | 实现定时刷新功能 | 待开发 |
| 7 | 添加服务器文件列表展示 | 待开发 |
| 8 | 测试验证 | 待测试 |