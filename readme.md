# koishi-plugin-memes

[![npm](https://img.shields.io/npm/v/koishi-plugin-memes?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-memes)

生成 Meme 表情包，支持 [MemeGenerator](https://github.com/MemeCrafters/meme-generator) (Python) 和 [meme-generator-rs](https://github.com/MemeCrafters/meme-generator-rs) (Rust)，并提供内置模板和自定义 API 接口。

## ✨ 功能特性

- **双后端支持**: 完美兼容 Python 版和 Rust 版的 Meme 生成器后端，按需切换。
- **丰富的模板库**: 通过后端支持数百种表情模板，可根据关键词搜索和匹配。
- **内置图片生成**: 预设了"你要被夹"、"你要被炸"等有趣的图片合成模板。
- **图像处理工具**: 当使用 `meme-generator-rs` 后端时，可启用图片翻转、旋转、灰度化等多种实用工具。
- **自定义 API**: 可通过简单配置接入任意外部图像 API，轻松扩展表情库。
- **关键词触发**: 可选的中间件功能，能够监听聊天内容，通过关键词自动生成表情。

## ⚙️ 配置选项

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `loadApi` | `boolean` | `false` | 是否开启自定义 API 表情生成功能。 |
| `loadInternal` | `boolean` | `false` | 是否开启内置的图片合成功能（如：夹、炸）。 |
| `genUrl` | `string` | `http://localhost:2233` | MemeGenerator 后端服务的 API 地址。 |
| `useRsBackend` | `boolean` | `false` | **是否使用 `meme-generator-rs` (Rust) 兼容后端。** 开启后会改变 API 调用方式。 |
| `useMiddleware` | `boolean` | `false` | 是否开启关键词匹配中间件，允许通过关键词直接触发表情生成。 |
| `requirePrefix` | `boolean` | `true` | 当中间件开启时，是否要求消息必须带有指令前缀才会触发。 |
| `blacklist` | `string` | `''` | 禁止生成的表情关键词黑名单，用英文逗号分隔。 |

## 📖 使用方法

插件提供了清晰的多级命令结构，方便使用。

### 核心命令 (通用)

- `memes [page|all]` - 列出所有可用的表情模板。
  - `memes 2` 显示第二页，`memes all` 以图片形式显示全部。
- `memes.make <关键词> [参数]` - 使用模板ID或关键词生成表情。
- `memes.info <关键词>` - 获取模板的详细信息，包括所需参数和用法示例。
- `memes.search <关键词>` - 根据模板ID、关键词或标签搜索表情模板。
- `memes.reload` - 刷新表情模板缓存（需要3级权限）。

### 内置模板 (`loadInternal: true`)

- `memes.make.jiazi [target]` - 生成"你要被夹"图片。
- `memes.make.tntboom [target]`- 生成"你要被炸"图片。
- `memes.make.zhuo [target]` - 生成"你要被捉"图片。

### 图像工具 (`useRsBackend: true`)

- `memes.tools.flip_h <图片>` - 水平翻转图片。
- `memes.tools.flip_v <图片>` - 垂直翻转图片。
- `memes.tools.grayscale <图片>` - 将图片灰度化。
- `memes.tools.invert <图片>` - 将图片颜色反相。
- `memes.tools.rotate <图片> [degrees]` - 旋转图片（默认90度）。

### 自定义 API (`loadApi: true`)

- `meme [page]` - 列出自定义 API 的表情列表。
- `meme.make [type] [arg1] [arg2]` - 使用指定的自定义 API 生成表情。

---

### 💡 示例

**查看和搜索模板**
    ```text
    memes          # 查看第一页模板
    memes.search 吃  # 搜索包含"吃"的模板
    memes.info 摸    # 查看"摸"模板的详细信息
    ```

**生成表情**
    ```text
    memes.make 摸 @用户         # 基础用法
    memes.make ba_say 你好 -character=1 # 使用选项参数
    memes.make look_flat "你好 世界" # 文本参数包含空格
    ```

**使用内置模板**
    ```text
    memes.make.jiazi @用户    # 对@用户使用夹子图
    memes.make.tntboom 123456789 # 对指定QQ号使用
    memes.make.zhuo             # 对自己使用
    ```
**使用图像工具 (需 rs 后端)**
    ```text
    # 发送 "memes.tools.flip_h" 并附带一张图片
    memes.tools.flip_h [图片]

    # 回复一张图片并发送 "memes.tools.rotate 30"
    memes.tools.rotate 30
    ```

**使用自定义 API**
    ```text
    meme                  # 查看自定义API列表
    meme.make 示例配置 @用户 # 使用名为"示例配置"的API
    ```

## 📝 参数说明

- **指定用户/图片**:

  - `@用户`: 直接 at 用户。
  - `123456789`: 直接输入QQ号。
  - 在消息中**直接发送图片**或**引用带图片的消息**，插件会自动识别。

- **文本参数**:

  - 多个文本参数用空格分隔。
  - 如果文本本身包含空格，请用英文双引号括起来，例如：`memes.make some_template "第一段文本" "第二段文本"`。

- **选项参数**:

  - 使用 `-参数=值` 或 `--参数=值` 的格式指定。
  - 对于布尔类型的开关选项，可直接使用 `-参数` 或 `--参数`。
  - 示例: `-character=1`、`--circle=true`、`-circle`。

## 🚀 关键词匹配中间件

当 `useMiddleware` 开启时，插件会监听聊天消息。如果消息内容以某个表情的关键词开头，将自动调用生成。

- 若 `requirePrefix` 为 `true` (默认)，消息需要以机器人设置的指令前缀 (如 `/` 或 `.` ) 开头才会触发。
  - 示例：发送 `.摸 @某人`，如果"摸"是关键词，将自动生成表情。
- 若 `requirePrefix` 为 `false`，任何以关键词开头的消息都会触发（请谨慎使用，可能导致误触发）。

## 🔧 自定义 API 配置

你可以在 Koishi 数据目录下的 `data/memes-api.json` 文件中添加自己的 API 接口。如果文件不存在，插件会自动创建一个示例文件。

每个 API 配置项包含：

- `description`: 表情描述，也是 `meme.make` 命令中使用的名称。
- `apiEndpoint`: API 的 URL 地址，支持以下占位符：
  - `${arg1}`: 会被替换为第一个参数 (如QQ号或文本)。
  - `${arg2}`: 会被替换为第二个参数。
