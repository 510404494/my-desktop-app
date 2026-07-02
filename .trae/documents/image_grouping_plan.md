# 图片分组展示规划

## 需求分析

### 当前问题
图片列表中存在大量同名但不同后缀的图标文件，例如：
- `chujun.png`, `chujun_chushi_active.png`, `chujun_jiankangfeng_active.png`... (6个变体)
- `chushi.png`, `chushi_active.png` (2个变体)
- `wind_auto.png`, `wind_auto_white.png` (2个变体)

这导致展示空间浪费，用户需要频繁滚动查看。

### 分组规律
通过分析文件名，发现以下命名模式：

| 模式类型 | 示例 | 变体数量 |
|---------|------|---------|
| 基础+激活 | `chushi.png`, `chushi_active.png` | 2 |
| 基础+模式激活 | `chujun.png`, `chujun_chushi_active.png`, `chujun_jiankangfeng_active.png`... | 6 |
| 不同颜色 | `wind_auto.png`, `wind_auto_white.png` | 2 |
| 开关状态 | `ic_power_on.png`, `ic_power_off.png` | 2 |

### 目标
将相同前缀的图片分组展示，节省空间，提升浏览效率。

## 方案设计

### 方案一：折叠式分组卡片（推荐）
每个分组显示一个卡片，包含：
- 主图标（基础状态图标）
- 变体标签（显示有多少个变体）
- 点击展开显示所有变体的缩略图

**优点：**
- 节省大量空间（约减少 50-70% 的卡片数量）
- 保留原有搜索、编辑别名功能
- 交互直观，用户可快速查看所有变体

### 方案二：变体标签展示
在单个卡片上横向展示多个变体图标

**缺点：**
- 卡片宽度受限，变体会被压缩
- 不适合变体量多的分组（如 chujun 有6个变体）

### 方案三：模态框内展示变体
点击主图标后，在模态框内展示所有变体

**缺点：**
- 需要额外点击才能看到变体
- 不直观

## 实现步骤

### 文件修改

#### 1. 修改 ImageNav.tsx
- 添加分组逻辑，将图片按前缀分组
- 修改渲染逻辑，支持分组卡片展示
- 添加展开/折叠功能
- 保留搜索和编辑别名功能

#### 2. 修改 App.css
- 添加分组卡片的样式
- 添加变体标签样式
- 添加展开区域样式

### 分组算法

```typescript
// 分组规则优先级（从高到低）
1. 匹配模式：{name}_{mode}_active.png → 分组到 {name}
   其中 mode 可以是：chushi, jiankangfeng, songfeng, zhileng, zhire

2. 匹配模式：{name}_active.png → 分组到 {name}

3. 匹配模式：{name}_on.png 或 {name}_off.png → 分组到 {name}

4. 匹配模式：{name}_white.png → 分组到 {name}

5. 单独文件（无变体）→ 保持独立
```

### 新的数据结构

```typescript
interface ImageGroup {
  id: string;                    // 分组标识（前缀名）
  baseFilename: string;          // 基础文件名（无后缀的那个）
  variants: ImageVariant[];      // 所有变体
  isExpanded: boolean;           // 是否展开
}

interface ImageVariant {
  filename: string;
  type: 'base' | 'active' | 'mode_active' | 'color' | 'state';
  mode?: string;                 // 模式名（如 chushi, jiankangfeng）
}
```

### UI 设计

**分组卡片（折叠状态）：**
```
┌──────────────────────┐
│   [主图标]           │
│                      │
│   chujun            │
│   [6个变体]          │
└──────────────────────┘
```

**分组卡片（展开状态）：**
```
┌──────────────────────┐
│   [主图标]           │
│                      │
│   chujun            │
│   ────────────────  │
│   [chushi] [jiankang]│
│   [songfeng] [zhileng]│
│   [zhire]           │
└──────────────────────┘
```

## 风险与注意事项

### 1. 分组准确性
- 需要确保分组算法能正确识别所有变体模式
- 特殊文件名（如 `shushi_active -.png`）需要特殊处理

### 2. 搜索功能兼容
- 搜索应同时匹配分组名和变体文件名
- 搜索结果应显示匹配的分组或单独文件

### 3. 编辑别名功能
- 编辑别名应作用于整个分组
- 或为每个变体单独编辑

### 4. 性能考虑
- 分组计算应在初始化时完成，避免每次渲染重复计算
- 懒加载仍需保留

## 开发步骤

### 步骤一：添加分组工具函数
在 ImageNav.tsx 中添加分组逻辑函数

### 步骤二：修改状态管理
将 `pics` 状态改为分组结构

### 步骤三：修改渲染组件
实现分组卡片的渲染逻辑

### 步骤四：添加展开/折叠交互
实现点击展开和关闭功能

### 步骤五：调整 CSS 样式
添加分组相关的样式

### 步骤六：测试验证
- 验证分组准确性
- 验证搜索功能
- 验证编辑功能

## 预期效果

- 图片卡片数量从 203 张减少到约 40-50 个分组
- 用户可以快速浏览所有功能类别
- 点击分组可查看所有状态变体
- 保持原有搜索和编辑功能完整
