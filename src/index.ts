import { Context, Schema, h } from 'koishi'
import axios from 'axios'
import { emoticonTypes as defaultEmoticonTypes, EmoticonConfig } from './emoticontype'
import fs from 'fs'
import path from 'path'

export const name = 'memes'

export interface Config {
  loadExternal?: boolean
}

export const Config: Schema<Config> = Schema.object({
  loadExternal: Schema.boolean()
    .description('是否从文件中加载 API 配置').default(true)
})

/**
 * 初始化表情包配置
 */
function initEmoticonTypes(ctx: Context, config: Config): EmoticonConfig[] {
  const logger = ctx.logger('memes')
  const configPath = path.resolve(ctx.baseDir, 'data', 'memes.json')
  // 不存在则创建默认配置
  if (!fs.existsSync(configPath)) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(defaultEmoticonTypes, null, 2), 'utf-8')
      logger.info(`已创建表情包配置：${configPath}`)
      return defaultEmoticonTypes
    } catch (e) {
      logger.error(`创建配置文件失败：${e.message}`)
      return defaultEmoticonTypes
    }
  }
  // 加载外部配置
  if (config.loadExternal) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8')
      const externalTypes = JSON.parse(content) as EmoticonConfig[]
      logger.info(`已加载外部配置：${configPath}（共${externalTypes.length}项）`)
      return externalTypes
    } catch (e) {
      logger.error(`加载外部配置失败：${e.message}`)
      return defaultEmoticonTypes
    }
  }
  return defaultEmoticonTypes
}

/**
 * 解析目标用户ID (支持@元素、@数字格式或纯数字)
 */
function parseTarget(target: string): string | null {
  if (!target) return null
  // 尝试解析at元素
  try {
    const atElement = h.select(h.parse(target), 'at')[0]
    if (atElement?.attrs?.id) return atElement.attrs.id
  } catch {}
  // 尝试匹配@数字格式或纯数字
  const atMatch = target.match(/@(\d+)/)
  const userId = atMatch ? atMatch[1] : (/^\d+$/.test(target.trim()) ? target.trim() : null)
  return userId && /^\d{5,10}$/.test(userId) ? userId : null
}

/**
 * 显示表情包类型菜单，支持分页
 */
function showMenu(emoticonTypes: EmoticonConfig[], page: number | string = 1): string {
  const MAX_CHAR_PER_LINE = 32
  const LINES_PER_PAGE = 10
  // 处理特殊页码
  let showAll = page === 'all'
  if (typeof page === 'string') {
    page = parseInt(page) || 1
  }
  // 获取所有表情类型的描述
  const descriptions = emoticonTypes.map(type => type.description.split('|')[0].trim())
  // 按行格式化菜单项
  const formatLines = () => {
    let lines = []
    let currentLine = ''

    for (const desc of descriptions) {
      // 如果当前行添加这个描述会超出最大字符数，则另起一行
      if (currentLine.length + desc.length + 2 > MAX_CHAR_PER_LINE && currentLine.length > 0) {
        lines.push(currentLine)
        currentLine = desc
      } else {
        // 如果是新行就不加空格，否则加空格作为分隔
        currentLine = currentLine.length === 0 ? desc : `${currentLine} ${desc}`
      }
    }
    // 添加最后一行
    if (currentLine.length > 0) {
      lines.push(currentLine)
    }
    return lines
  }

  const allLines = formatLines()
  const totalPages = Math.ceil(allLines.length / LINES_PER_PAGE)
  // 确保页码有效
  const validPage = Math.max(1, Math.min(page as number, showAll ? 1 : totalPages))
  // 根据分页或全部显示模式获取要显示的行
  const displayLines = showAll
    ? allLines
    : allLines.slice((validPage - 1) * LINES_PER_PAGE, validPage * LINES_PER_PAGE)
  // 构建菜单标题和内容
  let menu = "";
  if (showAll) {
    menu = `表情列表（共${emoticonTypes.length}项）\n`;
  } else if (totalPages > 1) {
    menu = `表情列表（第${validPage}/${totalPages}页）\n`;
  } else {
    menu = "表情列表\n";
  }
  return menu + displayLines.join('\n')
}

/**
 * 生成表情包图片
 */
async function generateImage(config: EmoticonConfig, arg1: string, arg2: string, session): Promise<string> {
  // 处理参数，解析@用户
  const parseArg = (arg: string, defaultValue: string) => {
    if (!arg) return defaultValue
    const parsedId = parseTarget(arg)
    return parsedId || arg
  }
  // 获取默认值和处理参数
  const defaultArg1 = session.userId
  const defaultArg2 = '测试文本'
  const processedArg1 = parseArg(arg1, defaultArg1)
  const processedArg2 = parseArg(arg2, defaultArg2)
  // 替换参数占位符
  let url = config.apiEndpoint
    .replace(/\${arg1}/g, processedArg1)
    .replace(/\${arg2}/g, processedArg2)
  try {
    // 请求API
    const response = await axios.get(url, {
      timeout: 8000,
      validateStatus: () => true,
      responseType: 'text'
    })
    // 处理JSON响应
    if (response.headers['content-type']?.includes('application/json')) {
      try {
        const jsonData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
        return jsonData?.code === 200 ? jsonData.data : url
      } catch {
        return url
      }
    }
    return url
  } catch (error) {
    throw new Error(`请求失败: ${error.message}`)
  }
}

export function apply(ctx: Context, config: Config) {
  const emoticonTypes = initEmoticonTypes(ctx, config)

  const memes = ctx.command('memes [type:string] [arg1:string] [arg2:string]', '制作 Meme 表情包')
    .usage('选择表情类型，并输入参数生成表情包')
    .example('memes 吃 @用户 - 生成"吃"表情')
    .example('memes 喜报 文本 - 生成喜报')
    .example('memes 牵手 @用户1 @用户2 - 生成双人表情')
    .action(async ({ session }, type, arg1, arg2) => {
      let typeIndex = -1;
      // 随机选择
      if (!type) {
        typeIndex = Math.floor(Math.random() * emoticonTypes.length);
      } else {
        // 匹配表情类型
        typeIndex = emoticonTypes.findIndex(t => {
          const descriptions = t.description.split('|')
          return descriptions.some(desc => desc.trim() === type.trim())
        });
        if (typeIndex === -1) {
          return `未找到与"${type}"匹配的表情类型`;
        }
      }
      // 使用参数生成图片
      try {
        const imageUrl = await generateImage(emoticonTypes[typeIndex], arg1, arg2, session)
        return imageUrl ? h('image', { url: imageUrl }) : '生成表情包失败'
      } catch (error) {
        return '生成表情包出错：' + error.message
      }
    })

  memes.subcommand('.list [page:string]', '显示表情包类型列表')
    .usage('使用"all"显示全部表情类型')
    .action(({}, page) => {
      return showMenu(emoticonTypes, page || 1)
    })

  memes.subcommand('.reload', '重新加载配置', { authority: 3 })
    .action(() => {
      try {
        // 重新加载配置并更新引用
        const newTypes = initEmoticonTypes(ctx, config)
        // 清空并重新填充数组
        emoticonTypes.length = 0
        newTypes.forEach(type => emoticonTypes.push(type))
        return `已重新加载配置（共${emoticonTypes.length}项）`
      } catch (error) {
        return '重新加载配置失败：' + error.message
      }
    })
}
