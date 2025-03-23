# koishi-plugin-memes

[![npm](https://img.shields.io/npm/v/koishi-plugin-memes?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-memes)

生成 Meme 表情包，支持 MemeGenerator 和任意 API 接口

## 功能介绍

支持多种类型的 Meme 表情包生成，包括：

- MemeGenerator API生成的表情包(支持数百种模板)
- 内置模板表情包（如"你要被夹"、"你要被炸"等）
- 自定义API接口表情包（可通过配置文件自定义）

插件通过多种方式生成表情，功能丰富且易于扩展。

## 使用方法

插件提供了多种命令用于生成表情包：

### 基础命令

- `memes [key] [...texts]` - 使用MemeGenerator API生成表情
- `memes.list [page]` - 列出可用模板列表(可用"all"参数查看全部)
- `memes.info [key]` - 获取模板详细信息

### 内置模板

- `memes.make.jiazi [target]` - 生成"你要被夹"图片
- `memes.make.tntboom [target]` - 生成"你要被炸"图片

### 自定义API（需开启loadApi）

- `memes.api [type] [arg1] [arg2]` - 使用自定义API生成表情
- `memes.api.list [page]` - 列出可用自定义API表情
- `memes.api.reload` - 重载自定义API配置

### 示例

1. 查看所有可用模板：

   ```text
   memes.list
   ```

2. 生成指定模板的表情包：

   ```text
   memes play @用户 文本内容
   ```

3. 生成内置模板表情：

   ```text
   memes.make.jiazi @用户
   ```

4. 使用自定义API生成表情：

   ```text
   memes.api 吃 @用户1 @用户2
   ```

## 参数说明

插件支持多种方式指定用户：

- @用户
- @123456789（数字QQ号）
- 123456789（直接输入QQ号）

## 配置选项

- `loadApi`: 是否开启自定义API生成功能（默认关闭）
- `genUrl`: MemeGenerator API地址（默认为"localhost:2233"）

## 自定义API配置

可通过修改 `data/memes.json` 文件来自定义API表情，每个表情类型需要包含：

- `description`：表情包描述
- `apiEndpoint`：生成表情的API地址，支持以下占位符：
  - `${arg1}`：第一个参数（通常是用户ID）
  - `${arg2}`：第二个参数（通常是另一个用户ID）
