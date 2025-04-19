# koishi-plugin-memes

[![npm](https://img.shields.io/npm/v/koishi-plugin-memes?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-memes)

生成 Meme 表情包，支持 MemeGenerator API、内置模板和自定义 API 接口

## 功能介绍

支持多种类型的 Meme 表情包生成，包括：

- **MemeGenerator API**: 支持数百种表情模板，可根据关键词搜索和匹配
- **内置模板表情**: 预设模板如"你要被夹"、"你要被炸"等图片生成
- **自定义API接口**: 可通过配置文件自定义外部API，轻松扩展功能

插件采用多级命令结构，支持参数解析、图片处理和用户交互，可以生成丰富的表情包。

## 使用方法

插件提供了多种命令用于生成表情包：

### 基础命令

- `memes [page]` - 列出可用模板列表（可用"all"参数查看全部）
- `memes.make <key> [args]` - 使用模板ID或关键词生成表情
- `memes.info [key]` - 获取模板详细信息和使用参数（支持模板ID和关键词）
- `memes.search <keyword>` - 搜索表情模板（支持模板ID、关键词和标签）
- `memes.refresh` - 刷新表情模板缓存（需要管理员权限）

### 内置模板

- `make.jiazi [target]` - 生成"你要被夹"图片
- `make.tntboom [target]` - 生成"你要被炸"图片

### 自定义API（需开启loadApi）

- `meme [page]` - 列出可用自定义API表情
- `meme.make [type] [arg1] [arg2]` - 使用自定义API生成表情
- `meme.reload` - 重载自定义API配置（需要管理员权限）

### 示例

1. 查看模板列表：

   ```text
   memes
   memes 2    # 查看第二页
   memes all  # 查看所有模板
   ```

2. 生成表情包：

   ```text
   memes.make play @用户            # 基础用法
   memes.make ba_say 你好 -character=1  # 使用参数
   memes.make 摸 @用户 -circle     # 使用关键词和参数
   ```

3. 查询模板信息：

   ```text
   memes.info ba_say    # 查看模板详情
   memes.search 吃      # 搜索包含"吃"的模板
   ```

4. 内置模板：

   ```text
   make.jiazi @用户  # 生成夹子图
   make.jiazi 123456789  # 使用QQ号
   make.tntboom  # 使用自己头像
   ```

5. 自定义API：

   ```text
   meme       # 查看自定义API列表
   meme.make 吃 @用户  # 生成"吃@用户"的表情包
   ```

## 参数说明

插件支持多种方式指定用户和图片：

- **用户指定**：
  - `@用户` - 直接@用户
  - `@123456789` - @特定QQ号
  - `123456789` - 直接输入QQ号  #除基础命令之外

- **图片与文本**：
  - 引用带图片的消息会自动提取图片
  - 可以在消息中直接插入图片
  - 多个文本参数用空格分隔
  - 包含空格的文本用引号括起来：`"这是 带空格 的文本"`

- **选项参数**：
  - 使用`-参数=值`或`-参数`格式指定参数
  - 例如：`-character=1`、`-circle=true`、`-flip`

## 配置选项

- `loadApi`: 是否开启自定义API生成功能（默认: false）
- `loadInternal`: 是否开启内置图片生成功能（默认: false）
- `genUrl`: MemeGenerator API地址（默认: "localhost:2233"）
- `useMiddleware`: 是否开启中间件关键词匹配（默认: false）
- `requirePrefix`: 是否开启关键词指令前缀（默认: true）

## 关键词匹配中间件

当开启`useMiddleware`选项时，插件会监听聊天消息中的关键词并自动生成表情包：

- 若`requirePrefix`开启，则需要以机器人指令前缀开头的消息才会触发匹配
- 若`requirePrefix`关闭，则所有消息都会尝试匹配关键词

例如，配置前缀为`.`，发送`.摸 @某人`时，若"摸"是有效的表情关键词，将自动生成摸头表情。

## 自定义API配置

可通过修改 `data/memes.json` 文件来自定义API表情，每个表情类型需要包含：

- `description`：表情包描述
- `apiEndpoint`：生成表情的API地址，支持以下占位符：
  - `${arg1}`：第一个参数（用户ID或文本）
  - `${arg2}`：第二个参数（另一个用户ID或文本）
