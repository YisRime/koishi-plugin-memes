import { Context, Schema, h, Logger } from 'koishi'
import { MemeAPI } from './api'
import { MemeMaker } from './make'
import { MemeGenerator } from './generator'

export const name = 'memes'
export const inject = {optional: ['puppeteer']}
export const logger = new Logger('memes')

/**
 * 插件配置接口
 * @interface Config
 */
export interface Config {
  loadApi: boolean
  genUrl: string
  useMiddleware: boolean
  requirePrefix: boolean
}

export const Config: Schema<Config> = Schema.object({
  loadApi: Schema.boolean()
    .description('开启自定义 API 生成功能').default(false),
  genUrl: Schema.string()
    .description('MemeGenerator API 配置').default('http://localhost:2233'),
  useMiddleware: Schema.boolean()
    .description('开启中间件关键词匹配').default(false),
  requirePrefix: Schema.boolean()
    .description('开启关键词指令前缀').default(true)
})

/**
 * 解析目标用户ID
 * @param {string} arg - 输入参数，可以是@用户格式或纯数字ID
 * @returns {string} 解析后的用户ID或原始输入
 */
export function parseTarget(arg: string): string {
  try {
    const atElement = h.select(h.parse(arg), 'at')[0]
    if (atElement?.attrs?.id) return atElement.attrs.id
  } catch {}
  const match = arg.match(/@(\d+)/)
  if (match) return match[1]
  if (/^\d+$/.test(arg.trim())) {
    const userId = arg.trim()
    if (/^\d{5,10}$/.test(userId)) return userId
  }
  return arg
}

/**
 * 获取用户头像URL
 * @param {any} session - 会话对象
 * @param {string} [userId] - 用户ID，不提供则使用会话中的用户ID
 * @returns {Promise<string>} 用户头像URL
 */
export async function getUserAvatar(session: any, userId?: string): Promise<string> {
  const targetId = userId || session.userId
  return (targetId === session.userId && session.user?.avatar) ?
    session.user.avatar :
    `https://q1.qlogo.cn/g?b=qq&nk=${targetId}&s=640`
}

/**
 * 发送消息并在指定时间后自动撤回
 * @param {any} session - 会话对象
 * @param {string | number} message - 要发送的消息内容或消息ID
 * @param {number} [delay=10000] - 撤回延迟时间(毫秒)
 * @returns {Promise<any>} 操作结果，失败时返回null
 */
export async function autoRecall(session: any, message: string | number, delay: number = 10000): Promise<any> {
  if (!message) return null
  try {
    const msg = typeof message === 'string' ? await session.send(message) : message
    setTimeout(async () => {
      await session.bot?.deleteMessage(session.channelId, msg.toString())
    }, delay)
    return null
  } catch (error) {
    return null
  }
}

/**
 * 插件主函数
 * @param {Context} ctx - Koishi上下文
 * @param {Config} config - 插件配置
 */
export function apply(ctx: Context, config: Config) {
  const apiUrl = !config.genUrl ? '' : config.genUrl.trim().replace(/\/+$/, '')
  const memeGenerator = new MemeGenerator(ctx, logger, apiUrl)
  const memeMaker = new MemeMaker(ctx)
  let keywordToTemplateMap = new Map<string, string>();
  let allKeywords: string[] = [];

  /**
   * 主命令: 制作表情包
   */
  const meme = ctx.command('memes <key:string> [args:text]', '制作表情包')
    .usage('输入模板ID或关键词并添加参数和选项来生成表情包\n例:memes 模板ID/关键词 文本/图片 -参数=值\n多个文本以空格分隔,包含空格的文本须带引号\n可手动添加图片或@用户添加头像\n需使用"."触发子指令，如:memes.list')
    .example('memes ba_say 你好 -character=1 - 使用模板ID"ba_say"生成"心奈说:你好"的表情')
    .example('memes 摸 @用户 - 使用关键词"摸"生成摸头表情')
    .action(async ({ session }, key, args) => {
      if (!key) {
        return autoRecall(session, '请提供模板ID或关键词')
      }
      const elements = args ? [h('text', { content: args })] : []
      return memeGenerator.generateMeme(session, key, elements)
    })

  /**
   * 子命令: 列出可用模板列表
   */
  meme.subcommand('.list [page:string]', '列出可用模板列表')
    .usage('输入页码查看列表或使用"all"查看所有模板')
    .example('memes.list - 查看第一页模板列表')
    .example('memes.list all - 查看所有模板列表')
    .action(async ({ session }, page) => {
      let result;
      try {
        let keys: string[]
        if (memeGenerator['memeCache'].length > 0) {
          keys = memeGenerator['memeCache'].map(t => t.id)
        } else {
          const apiKeys = await memeGenerator['apiRequest'](`${memeGenerator['apiUrl']}/memes/keys`)
          keys = apiKeys
        }
        // 获取模板详情
        const allTemplates = await Promise.all(keys.map(async key => {
          const cachedTemplate = memeGenerator['memeCache'].find(t => t.id === key)
          if (cachedTemplate) {
            const info = cachedTemplate
            const keywords = info.keywords || []
            const tags = info.tags || []
            const pt = info.params_type || {}
            let imgReq = ''
            if (pt.min_images === pt.max_images) {
              imgReq = pt.min_images > 0 ? `图片${pt.min_images}` : ''
            } else {
              imgReq = pt.min_images > 0 || pt.max_images > 0 ? `图片${pt.min_images}-${pt.max_images}` : ''
            }
            let textReq = ''
            if (pt.min_texts === pt.max_texts) {
              textReq = pt.min_texts > 0 ? `文本${pt.min_texts}` : ''
            } else {
              textReq = pt.min_texts > 0 || pt.max_texts > 0 ? `文本${pt.min_texts}-${pt.max_texts}` : ''
            }
            return { id: info.id, keywords, imgReq, textReq, tags }
          }
          try {
            const info = await memeGenerator['apiRequest'](`${memeGenerator['apiUrl']}/memes/${key}/info`)
            if (!info) return { id: key, keywords: [], imgReq: '', textReq: '', tags: [] }
            const template = {
              id: key,
              keywords: info.keywords ? (Array.isArray(info.keywords) ? info.keywords : [info.keywords]) : [],
              tags: info.tags && Array.isArray(info.tags) ? info.tags : [],
              params_type: info.params_type || {}
            }
            const keywords = template.keywords || []
            const tags = template.tags || []
            const pt = template.params_type || {}
            let imgReq = ''
            if (pt.min_images === pt.max_images) {
              imgReq = pt.min_images > 0 ? `图片${pt.min_images}` : ''
            } else {
              imgReq = pt.min_images > 0 || pt.max_images > 0 ? `图片${pt.min_images}-${pt.max_images}` : ''
            }
            let textReq = ''
            if (pt.min_texts === pt.max_texts) {
              textReq = pt.min_texts > 0 ? `文本${pt.min_texts}` : ''
            } else {
              textReq = pt.min_texts > 0 || pt.max_texts > 0 ? `文本${pt.min_texts}-${pt.max_texts}` : ''
            }
            return { id: template.id, keywords, imgReq, textReq, tags }
          } catch (err) {
            return { id: key, keywords: [], imgReq: '', textReq: '', tags: [] }
          }
        }))
        // 收集关键词
        const allKeywords: string[] = []
        allTemplates.forEach(template => {
          if (template.keywords.length > 0) allKeywords.push(...template.keywords)
          else allKeywords.push(template.id)
        })
        // 格式化行
        const formattedLines: string[] = []
        let currentLine = ''
        for (const keyword of allKeywords) {
          const separator = currentLine ? ' ' : ''
          let displayWidth = 0
          const stringToCheck = currentLine + separator + keyword
          for (let i = 0; i < stringToCheck.length; i++) {
            displayWidth += /[\u4e00-\u9fa5\uff00-\uffff]/.test(stringToCheck[i]) ? 2 : 1
          }
          if (displayWidth <= 36) {
            currentLine += separator + keyword
          } else {
            formattedLines.push(currentLine)
            currentLine = keyword
          }
        }
        if (currentLine) formattedLines.push(currentLine)
        // 分页
        const LINES_PER_PAGE = 10
        const showAll = page === 'all'
        const pageNum = typeof page === 'string' ? (parseInt(page) || 1) : (page || 1)
        const totalPages = Math.ceil(formattedLines.length / LINES_PER_PAGE)
        const validPage = Math.max(1, Math.min(pageNum, totalPages))
        const displayLines = showAll
          ? formattedLines
          : formattedLines.slice((validPage - 1) * LINES_PER_PAGE, validPage * LINES_PER_PAGE)
        result = {
          keys,
          totalTemplates: allTemplates.length,
          totalKeywords: allKeywords.length,
          displayLines,
          totalPages,
          validPage,
          showAll
        }
      } catch (err) {
        return autoRecall(session, `获取模板列表失败: ${err.message}`)
      }
      const { totalTemplates, displayLines, totalPages, validPage, showAll } = result
      const header = showAll
        ? `表情模板列表（共${totalTemplates}个）\n`
        : totalPages > 1
          ? `表情模板列表（${validPage}/${totalPages}页）\n`
          : `表情模板列表（共${totalTemplates}个）\n`
      return header + displayLines.join('\n')
    })

  /**
   * 子命令: 获取模板详细信息
   */
  meme.subcommand('.info [key:string]', '获取模板详细信息')
    .usage('查看指定模板的详细信息和参数')
    .example('memes.info ba_say - 查看"ba_say"模板的详细信息和参数')
    .example('memes.info 吃 - 查看包含"吃"关键词的模板的详细信息和参数')
    .action(async ({ session }, key) => {
      if (!key) {
        return autoRecall(session, '请提供模板ID或关键词')
      }
      try {
        const template = await memeGenerator.findTemplate(key);
        if (!template) return autoRecall(session, `未找到表情模板"${key}"`);
        const templateId = template.id
        const response = []
        // 获取预览图片
        try {
          const previewImage = await memeGenerator['apiRequest'](
            `${memeGenerator['apiUrl']}/memes/${templateId}/preview`,
            { responseType: 'arraybuffer', timeout: 8000 }
          )
          if (previewImage) {
            const base64 = Buffer.from(previewImage).toString('base64')
            response.push(h('image', { url: `data:image/png;base64,${base64}` }))
          }
        } catch (previewErr) {
          logger.warn(`获取预览图失败: ${templateId}`)
        }
        // 详细信息
        const outputContent = []
        const keywords = Array.isArray(template.keywords) ? template.keywords : [template.keywords].filter(Boolean)
        // 标题信息与参数需求
        outputContent.push(`模板"${keywords.join(', ')}(${templateId})"详细信息:`)
        if (template.tags?.length) outputContent.push(`标签: ${template.tags.join(', ')}`)
        const pt = template.params_type || {}
        outputContent.push('需要参数:')
        outputContent.push(`- 图片: ${pt.min_images || 0}${pt.max_images !== pt.min_images ? `-${pt.max_images}` : ''}张`)
        outputContent.push(`- 文本: ${pt.min_texts || 0}${pt.max_texts !== pt.min_texts ? `-${pt.max_texts}` : ''}条`)
        if (pt.default_texts?.length) outputContent.push(`- 默认文本: ${pt.default_texts.join(', ')}`)
        // 其他参数
        if (pt.args_type?.args_model?.properties) {
          outputContent.push('其他参数:')
          const properties = pt.args_type.args_model.properties
          const definitions = pt.args_type.args_model.$defs || {}
          // 处理顶层属性
          for (const key in properties) {
            if (key === 'user_infos') continue
            const prop = properties[key]
            let propDesc = `- ${key}`
            // 添加类型信息
            if (prop.type) {
              let typeStr = prop.type
              if (prop.type === 'array' && prop.items?.$ref) {
                const refTypeName = prop.items.$ref.replace('#/$defs/', '').split('/')[0]
                typeStr = `${prop.type}<${refTypeName}>`
              }
              propDesc += ` (${typeStr})`
            }
            // 添加默认值和描述
            if (prop.default !== undefined) propDesc += ` 默认值: ${JSON.stringify(prop.default)}`
            if (prop.description) propDesc += ` - ${prop.description}`
            if (prop.enum?.length) propDesc += ` [可选值: ${prop.enum.join(', ')}]`
            outputContent.push(propDesc)
          }
          // 展示类型定义
          if (Object.keys(definitions).length > 0) {
            outputContent.push('类型定义:')
            for (const typeName in definitions) {
              outputContent.push(`- ${typeName}:`)
              const typeDef = definitions[typeName]
              if (typeDef.properties) {
                for (const propName in typeDef.properties) {
                  const prop = typeDef.properties[propName]
                  let propDesc = `  • ${propName}`
                  if (prop.type) propDesc += ` (${prop.type})`
                  if (prop.default !== undefined) propDesc += ` 默认值: ${JSON.stringify(prop.default)}`
                  if (prop.description) propDesc += ` - ${prop.description}`
                  if (prop.enum?.length) propDesc += ` [可选值: ${prop.enum.join(', ')}]`
                  outputContent.push(propDesc)
                }
              }
            }
          }
        }
        // 命令行参数
        if (pt.args_type?.parser_options?.length) {
          outputContent.push('命令行参数:')
          pt.args_type.parser_options.forEach(opt => {
            const names = opt.names.join(', ')
            const argInfo = opt.args?.length ?
              opt.args.map(arg => {
                let argDesc = arg.name
                if (arg.value) argDesc += `:${arg.value}`
                if (arg.default !== null && arg.default !== undefined) argDesc += `=${arg.default}`
                return argDesc
              }).join(' ') : ''
            outputContent.push(`- ${names} ${argInfo}${opt.help_text ? ` - ${opt.help_text}` : ''}`)
          })
        }
        // 参数示例
        if (pt.args_type?.args_examples?.length) {
          outputContent.push('参数示例:')
          pt.args_type.args_examples.forEach((example, i) => {
            outputContent.push(`- 示例${i+1}: ${JSON.stringify(example)}`)
          })
        }
        // 快捷指令
        if (template.shortcuts?.length) {
          outputContent.push('快捷指令:')
          template.shortcuts.forEach(shortcut => {
            outputContent.push(`- ${shortcut.humanized || shortcut.key}${shortcut.args?.length ? ` (参数: ${shortcut.args.join(' ')})` : ''}`)
          })
        }
        // 创建和修改时间
        if (template.date_created || template.date_modified) {
          outputContent.push(`创建时间: ${template.date_created}\n修改时间: ${template.date_modified}`)
        }
        response.push(h('text', { content: outputContent.join('\n') }))
        return response
      } catch (err) {
        return autoRecall(session, `未找到模板: ${key} - ${err.message}`)
      }
    })

  /**
   * 子命令: 搜索表情模板
   */
  meme.subcommand('.search <keyword:string>', '搜索表情模板')
    .usage('根据关键词搜索表情模板')
    .example('memes.search 吃 - 搜索包含"吃"关键词的表情模板')
    .action(async ({ session }, keyword) => {
      if (!keyword) {
        return autoRecall(session, '请提供关键词')
      }
      try {
        const results = await memeGenerator.matchTemplates(keyword);
        if (!results || results.length === 0) {
          return autoRecall(session, `未找到有关"${keyword}"的表情模板`)
        }
        const resultLines = results.map(t => {
          let line = `${t.keywords}(${t.id})`
          if (t.tags?.length > 0) {
            line += ` #${t.tags.join('#')}`
          }
          return line
        })
        return `搜索结果（共${results.length}项）:\n` + resultLines.join('\n')
      } catch (err) {
        return autoRecall(session, `未找到模板: ${err.message}`)
      }
    })

  /**
   * 子命令: 刷新表情模板缓存
   */
  meme.subcommand('.refresh', '刷新表情模板缓存', { authority: 3 })
    .usage('手动刷新表情模板缓存数据')
    .action(async ({ session }) => {
      try {
        const result = await memeGenerator.refreshCache();
        if (config.useMiddleware) {
          keywordToTemplateMap.clear();
          allKeywords = [];
        }
        return `已刷新缓存文件：${result.length}项`;
      } catch (err) {
        return autoRecall(session, `刷新缓存失败：${err.message}`);
      }
    })

  // 监听消息
  if (config.useMiddleware) {
    ctx.on('message', async (session) => {
      if (allKeywords.length === 0) {
        keywordToTemplateMap = memeGenerator.getAllKeywordMappings();
        allKeywords = Array.from(keywordToTemplateMap.keys());
      }
      // 解析消息内容
      const rawContent = session.content;
      if (!rawContent) return;
      const elements = h.parse(rawContent);
      const firstTextElement = elements.find(el => el.type === 'text');
      if (!firstTextElement?.attrs?.content) return;
      // 处理消息文本和前缀
      let content = firstTextElement.attrs.content.trim();
      if (config.requirePrefix) {
        const prefixes = [].concat(ctx.root.config.prefix).filter(Boolean);
        if (prefixes.length) {
          const matched = prefixes.find(p => content.startsWith(p));
          if (!matched) return;
          content = content.slice(matched.length).trim();
        }
      }
      // 提取并检查关键词和参数
      const spaceIndex = content.indexOf(' ');
      const key = spaceIndex === -1 ? content : content.substring(0, spaceIndex);
      const templateId = keywordToTemplateMap.get(key);
      if (!templateId) return;
      // 准备参数
      const paramElements: h[] = [];
      if (spaceIndex !== -1) {
        const remainingText = content.substring(spaceIndex + 1).trim();
        if (remainingText) {
          paramElements.push(h('text', { content: remainingText }));
        }
      }
      // 添加其他元素
      for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (element !== firstTextElement) {
          paramElements.push(element);
        }
      }
      await session.send(await memeGenerator.generateMeme(session, key, paramElements));
    });
  }

  // 注册图片生成相关命令
  memeMaker.registerCommands(meme)
  // 初始化并注册外部API命令
  if (config.loadApi) {
    const externalApi = new MemeAPI(ctx, logger)
    externalApi.registerCommands(meme)
  }
}