# koishi-plugin-memes

[![npm](https://img.shields.io/npm/v/koishi-plugin-memes?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-memes)

通过 API 生成 Meme 表情包，可自行配置 API 以支持不同 Meme 生成

## 功能介绍

支持多种类型的 Meme 表情包生成，包括：

- 单人表情包（需要一个用户头像）
- 双人表情包（需要两个用户头像）
- 纯文本表情包（仅需文字内容）

插件通过可配置的 API 接口生成表情，灵活且易于扩展。

## 使用方法

插件提供了 `memes` 命令用于生成表情包：

- `memes` - 显示所有可用的表情包类型菜单
- `memes <序号> [@用户] [文本内容]` - 生成指定表情包

### 示例

1. 查看所有可用表情类型：

   ```text
   memes
   ```

2. 生成指定类型的表情包：

   ```text
   memes 1 @用户
   ```

3. 带有文本的表情包：

   ```text
   memes 2 @用户 这是一段文本
   ```

4. 纯文本表情包：

   ```text
   memes 3 这是一段文本
   ```

## 参数说明

插件支持多种方式指定用户：

- @用户
- @123456789（数字QQ号）
- 123456789（直接输入QQ号）

## 自定义表情类型

你可以通过修改 `emoticontype.ts` 文件来自定义表情包类型，每个表情类型需要包含：

- `description`：表情包描述
- `apiEndpoint`：生成表情的API地址，支持以下占位符：
  - `${qq}`：第一个用户的QQ号
  - `${qq2}`：第二个用户的QQ号（如需要）
  - `${text}`：文本内容（如需要）

## 常见问题

1. 如果生成的表情包显示失败，请检查网络连接或API地址是否有效
2. 确保你有使用相应API的权限
3. 对于需要用户头像的表情包，确保提供了有效的用户ID
