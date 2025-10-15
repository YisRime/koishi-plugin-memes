# koishi-plugin-memes

[![npm](https://img.shields.io/npm/v/koishi-plugin-memes?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-memes)

生成 Meme 表情包，支持 [meme-generator](https://github.com/MemeCrafters/meme-generator) 和 [meme-generator-rs](https://github.com/MemeCrafters/meme-generator-rs) 两种后端。

## ✨ 功能特性

- **双后端支持**: 完美兼容 Python 版 (`FastAPI`) 和 Rust 版 (`RsAPI`) 的 Meme 生成器后端，并通过访问后端版本号自动检测。
- **丰富的模板库**: 通过后端支持海量表情模板，可根据关键词和标签进行模糊搜索。
- **图文渲染**: 支持将模板列表和详情渲染为图片，需要可选依赖 `koishi-plugin-puppeteer`。
- **图像处理工具**: 当使用 `meme-generator-rs` 后端时，可启用图片水平/垂直翻转、灰度化、反色和倒放 GIF 等多种实用工具。
- **关键词快捷触发**: 可选的中间件功能，能够监听聊天内容，通过关键词（有/无前缀）自动生成表情。

## ⚙️ 配置选项

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `apiUrl` | `string` | `http://127.0.0.1:2233` | MemeGenerator 后端服务的 API 地址。 |
| `triggerMode` | `'disable' \| 'noprefix' \| 'prefix'` | `'disable'` | **关键词快捷触发模式**。`disable`: 关闭；`noprefix`: 无需前缀直接触发；`prefix`: 需要匹配全局指令前缀才会触发。 |

## 📖 使用方法

插件提供了清晰的多级命令结构，方便使用。

### 核心命令

- `memes.list [page]` - 列出所有可用的表情模板。
  - 在安装并配置好 `puppeteer` 插件后，将以图片形式展示所有模板。
  - 未使用 `puppeteer` 或渲染失败时，将以分页文本形式展示，例如 `memes.list 2` 显示第二页。
- `memes.make <关键词> [参数]` - 使用模板关键词生成表情。
- `memes.info <关键词>` - 获取模板的详细信息，包括所需参数和用法示例。若 `puppeteer` 可用，将以图片形式展示并附带预览图。
- `memes.search <关键词>` - 根据模板关键词或标签搜索表情模板。

### 图像工具 (仅在使用 `meme-generator-rs` 后端时可用)

- `memes.tool <图片>` - 对图片进行处理，需要配合以下选项之一使用：
  - `--hflip` - 水平翻转图片。
  - `--vflip` - 垂直翻转图片。
  - `--grayscale` - 将图片灰度化。
  - `--invert` - 将图片颜色反相。
  - `--reverse` - 倒放 GIF 动图。

---

### 💡 示例

**查看和搜索模板**：

```text
memes.list          # 查看模板列表
memes.search 吃     # 搜索包含"吃"的模板
memes.info 摸       # 查看"摸"模板的详细信息
```

**生成表情**：

```text
memes.make 摸 @用户            # 基础用法
memes.make 远离 "远离" "色图" # 传入多个文本参数
memes.make some_template -arg=value # 使用选项参数
```

**使用图像工具 (需 rs 后端)**：

```text
# 发送 "memes.tool --hflip" 并附带一张图片
memes.tool --hflip [图片]

# 回复一张图片并发送 "memes.tool --reverse"
memes.tool --reverse
```

## 📝 参数说明

- **指定用户/图片**:
  - `@用户`: 直接 at 用户，插件会自动获取其头像。
  - 在消息中**直接发送图片**或**引用带图片的消息**，插件会自动识别。
  - 如果模板需要图片但未提供，插件会自动使用发送者的头像。

- **文本参数**:
  - 多个文本参数用空格分隔。
  - 如果文本本身包含空格，请用英文双引号括起来，例如：`memes.make some_template "第一段文本" "第二段文本"`。

- **选项参数**:
  - 使用 `-参数=值` 或 `--参数=值` 的格式指定。
  - 对于布尔类型的开关选项，可直接使用 `-参数` 或 `--参数`。
  - 示例: `--circle=true`、`-circle`。

## 🚀 关键词快捷触发

当 `triggerMode` 设置为 `prefix` 或 `noprefix` 时，插件会监听聊天消息。如果消息内容以某个表情的关键词开头，将自动调用生成。

- 若 `triggerMode` 为 `prefix` (推荐)，消息需要以机器人设置的指令前缀 (如 `/` 或 `.` ) 开头才会触发。
  - 示例：发送 `.摸 @某人`，如果"摸"是关键词，将自动生成表情。
- 若 `triggerMode` 为 `noprefix`，任何以关键词开头的消息都会触发（请谨慎使用，可能导致误触发）。
