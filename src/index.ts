import { Context, Schema, h, Logger } from 'koishi'
import {} from 'koishi-plugin-puppeteer'
import { MemeAPI } from './api'
import { MemeMaker } from './make'
import { MemeGenerator } from './generator'
import { autoRecall, apiRequest, renderTemplateListAsImage, renderTemplateInfoAsImage } from './utils'

export const name = 'memes'
export const inject = {optional: ['puppeteer']}
export const logger = new Logger('memes')

/**
 * 插件配置接口定义
 */
export interface Config {
  loadApi: boolean
  loadInternal: boolean
  genUrl: string
  useMiddleware: boolean
  requirePrefix: boolean
}

/**
 * 插件配置Schema定义
 */
export const Config: Schema<Config> = Schema.object({
  loadApi: Schema.boolean()
    .description('开启自定义 API 生成').default(false),
  loadInternal: Schema.boolean()
    .description('开启内置图片生成').default(false),
  genUrl: Schema.string()
    .description('MemeGenerator API 配置').default('http://localhost:2233'),
  useMiddleware: Schema.boolean()
    .description('开启关键词匹配中间件').default(false),
  requirePrefix: Schema.boolean()
    .description('开启关键词匹配指令前缀').default(true)
})

/**
 * 插件主函数，处理表情包生成相关功能
 * @param ctx Koishi上下文
 * @param config 插件配置
 */
export function apply(ctx: Context, config: Config) {
  const apiUrl = config.genUrl?.trim().replace(/\/+$/, '') || ''
  const memeGenerator = new MemeGenerator(ctx, logger, apiUrl)
  const memeMaker = new MemeMaker(ctx)
  let keywordMap = new Map<string, string>()

  const meme = ctx.command('memes [page:string]', '表情生成')
    .usage('可通过 MemeGenerator 生成表情\n也可自定义 API 生成表情')
    .example('memes - 查看所有表情模板')
    .example('memes 2 - 仅在文本模式下查看第2页模板列表')
    .action(async ({ session }, page) => {
      try {
        let keys = memeGenerator['memeCache'].length > 0
          ? memeGenerator['memeCache'].map(t => t.id)
          : await apiRequest<string[]>(`${apiUrl}/memes/keys`, {}, logger) || []
        // 收集模板信息
        const allTemplates = await Promise.all(keys.map(async key => {
          const cachedTemplate = memeGenerator['memeCache'].find(t => t.id === key)
          if (cachedTemplate) {
            // 格式化模板信息
            const { id, keywords = [], tags = [], params_type: pt = {} } = cachedTemplate;
            const formatReq = (min, max, type = '') => {
              if (min === max && min) return `${type}${min}`
              if (min != null || max != null) return `${type}${min || 0}-${max || '∞'}`
              return ''
            }
            return {
              id,
              keywords: Array.isArray(keywords) ? keywords : [keywords].filter(Boolean),
              imgReq: formatReq(pt.min_images, pt.max_images, '图片'),
              textReq: formatReq(pt.min_texts, pt.max_texts, '文本'),
              tags: Array.isArray(tags) ? tags : []
            }
          }
          try {
            const info = await apiRequest(`${apiUrl}/memes/${key}/info`, {}, logger)
            if (!info) return { id: key, keywords: [], imgReq: '', textReq: '', tags: [] }
            const { keywords = [], tags = [], params_type: pt = {} } = info;
            const formatReq = (min, max, type = '') => {
              if (min === max && min) return `${type}${min}`
              if (min != null || max != null) return `${type}${min || 0}-${max || '∞'}`
              return ''
            }
            return {
              id: key,
              keywords: Array.isArray(keywords) ? keywords : [keywords].filter(Boolean),
              imgReq: formatReq(pt?.min_images, pt?.max_images, '图片'),
              textReq: formatReq(pt?.min_texts, pt?.max_texts, '文本'),
              tags: Array.isArray(tags) ? tags : []
            }
          } catch {
            return { id: key, keywords: [], imgReq: '', textReq: '', tags: [] }
          }
        }))
        // 尝试渲染图片
        if (ctx.puppeteer) {
          try {
            const pageTitle = `表情模板列表`;
            // 按关键词字母顺序排序
            allTemplates.sort((a, b) => {
              const keyA = a.keywords[0] || a.id;
              const keyB = b.keywords[0] || b.id;
              return keyA.localeCompare(keyB, 'zh-CN');
            });
            return renderTemplateListAsImage(ctx, pageTitle, allTemplates).then(buffer =>
              h('image', { url: `data:image/png;base64,${buffer.toString('base64')}` })
            );
          } catch (err) {
            logger.error('渲染模板列表图片失败：', err);
          }
        }
        // 文本模式收集关键词（仅在图片渲染失败时使用）
        const allKeywords = []
        allTemplates.forEach(template => {
          if (template.keywords.length > 0) allKeywords.push(...template.keywords)
          else allKeywords.push(template.id)
        })
        // 格式化为行
        const lines = []
        let currentLine = ''
        for (const keyword of allKeywords) {
          const separator = currentLine ? ' ' : ''
          let displayWidth = 0
          const testStr = currentLine + separator + keyword
          for (let i = 0; i < testStr.length; i++) {
            displayWidth += /[\u4e00-\u9fa5\uff00-\uffff]/.test(testStr[i]) ? 2 : 1
          }
          if (displayWidth <= 36) {
            currentLine += separator + keyword
          } else {
            lines.push(currentLine)
            currentLine = keyword
          }
        }
        if (currentLine) lines.push(currentLine)
        // 文本模式才需要分页
        const LINES_PER_PAGE = 10
        const showAll = page === 'all'
        const pageNum = typeof page === 'string' ? parseInt(page) || 1 : 1
        const totalPages = Math.ceil(lines.length / LINES_PER_PAGE)
        const validPage = Math.max(1, Math.min(pageNum, totalPages))
        const displayLines = showAll
          ? lines
          : lines.slice((validPage - 1) * LINES_PER_PAGE, validPage * LINES_PER_PAGE)
        const header = showAll
          ? `表情模板列表（共${allTemplates.length}个）\n`
          : totalPages > 1
            ? `表情模板列表（${validPage}/${totalPages}页）\n`
            : `表情模板列表（共${allTemplates.length}个）\n`
        return header + displayLines.join('\n')
      } catch (err) {
        return autoRecall(session, `获取模板列表失败: ${err.message}`)
      }
    })
  meme.subcommand('.make <key:string> [args:text]', 'Meme 表情生成')
    .usage('使用关键词或模板ID生成表情\n可添加文本、用户头像、图片等内容\n可用"-参数=值"来设置参数')
    .example('memes.make ba_say 你好 -character=1 - 使用"ba_say"生成角色"心奈"的表情')
    .example('memes.make 摸 @用户 - 使用"摸"生成表情')
    .action(async ({ session }, key, args) => {
      if (!key) return autoRecall(session, '请提供模板ID或关键词')
      const elements = args ? [h('text', { content: args })] : []
      return memeGenerator.generateMeme(session, key, elements)
    })
  meme.subcommand('.info [key:string]', '获取模板信息')
    .usage('查看指定模板的详细信息和参数\n包括需要的图片和文本数量和可选参数及示例')
    .example('memes.info ba_say - 查看"ba_say"模板的详细信息')
    .example('memes.info 摸 - 查看"摸"模板的详细信息')
    .action(async ({ session }, key) => {
      if (!key) return autoRecall(session, '请提供模板ID或关键词')
      try {
        const template = await memeGenerator.findTemplate(key)
        if (!template) return autoRecall(session, `未找到表情模板"${key}"`)
        const templateId = template.id
        // 获取预览图
        let previewImageBuffer = null
        let previewImageBase64 = null
        try {
          previewImageBuffer = await apiRequest(
            `${apiUrl}/memes/${templateId}/preview`,
            { responseType: 'arraybuffer', timeout: 8000 },
            logger
          )
          if (previewImageBuffer) {
            previewImageBase64 = `data:image/png;base64,${Buffer.from(previewImageBuffer).toString('base64')}`
          }
        } catch (err) {
          logger.warn(`获取预览图失败: ${templateId}`)
        }
        // 尝试使用puppeteer渲染图片
        if (ctx.puppeteer) {
          try {
            const infoImage = await renderTemplateInfoAsImage(ctx, template, previewImageBase64)
            return h('image', { url: `data:image/png;base64,${infoImage.toString('base64')}` })
          } catch (err) {
            logger.error('渲染模板信息图片失败：', err)
          }
        }
        // 文本模式（作为备用选项）
        const response = []
        if (previewImageBuffer) {
          response.push(h('image', { url: previewImageBase64 }))
        }
        const output = []
        const keywords = Array.isArray(template.keywords) ? template.keywords : [template.keywords].filter(Boolean)
        // 基本信息
        output.push(`模板"${keywords.join(', ')}(${template.id})"详细信息:`)
        if (template.tags?.length) output.push(`标签: ${template.tags.join(', ')}`)
        // 参数需求
        const pt = template.params_type || {}
        output.push('需要参数:')
        output.push(`- 图片: ${pt.min_images || 0}${pt.max_images !== pt.min_images ? `-${pt.max_images}` : ''}张`)
        output.push(`- 文本: ${pt.min_texts || 0}${pt.max_texts !== pt.min_texts ? `-${pt.max_texts}` : ''}条`)
        if (pt.default_texts?.length) output.push(`- 默认文本: ${pt.default_texts.join(', ')}`)
        // 其他参数
        if (pt.args_type?.args_model?.properties) {
          output.push('其他参数:')
          const properties = pt.args_type.args_model.properties
          const definitions = pt.args_type.args_model.$defs || {}
          // 顶层属性
          for (const key in properties) {
            if (key === 'user_infos') continue
            const prop = properties[key]
            let desc = `- ${key}`
            if (prop.type) {
              let typeStr = prop.type
              if (prop.type === 'array' && prop.items?.$ref) {
                const refType = prop.items.$ref.replace('#/$defs/', '').split('/')[0]
                typeStr = `${prop.type}<${refType}>`
              }
              desc += ` (${typeStr})`
            }
            if (prop.default !== undefined) desc += ` 默认值: ${JSON.stringify(prop.default)}`
            if (prop.description) desc += ` - ${prop.description}`
            if (prop.enum?.length) desc += ` [可选值: ${prop.enum.join(', ')}]`
            output.push(desc)
          }
          // 类型定义
          if (Object.keys(definitions).length) {
            output.push('类型定义:')
            for (const typeName in definitions) {
              output.push(`- ${typeName}:`)
              const typeDef = definitions[typeName]
              if (typeDef.properties) {
                for (const propName in typeDef.properties) {
                  const prop = typeDef.properties[propName]
                  let propDesc = `  • ${propName}`
                  if (prop.type) propDesc += ` (${prop.type})`
                  if (prop.default !== undefined) propDesc += ` 默认值: ${JSON.stringify(prop.default)}`
                  if (prop.description) propDesc += ` - ${prop.description}`
                  if (prop.enum?.length) propDesc += ` [可选值: ${prop.enum.join(', ')}]`
                  output.push(propDesc)
                }
              }
            }
          }
        }
        // 命令行参数
        if (pt.args_type?.parser_options?.length) {
          output.push('命令行参数:')
          pt.args_type.parser_options.forEach(opt => {
            let desc = `- ${opt.names.join(', ')}`
            if (opt.args?.length) {
              const argsText = opt.args.map(arg => {
                let argDesc = arg.name
                if (arg.value) argDesc += `:${arg.value}`
                if (arg.default !== null && arg.default !== undefined) argDesc += `=${arg.default}`
                return argDesc
              }).join(' ')
              desc += ` ${argsText}`
            }
            if (opt.help_text) desc += ` - ${opt.help_text}`
            output.push(desc)
          })
        }
        // 参数示例
        if (pt.args_type?.args_examples?.length) {
          output.push('参数示例:')
          pt.args_type.args_examples.forEach((example, i) => {
            output.push(`- 示例${i+1}: ${JSON.stringify(example)}`)
          })
        }
        // 快捷指令
        if (template.shortcuts?.length) {
          output.push('快捷指令:')
          template.shortcuts.forEach(shortcut => {
            output.push(`- ${shortcut.humanized || shortcut.key}${shortcut.args?.length ? ` (参数: ${shortcut.args.join(' ')})` : ''}`)
          })
        }
        // 创建和修改时间
        if (template.date_created || template.date_modified) {
          output.push(`创建时间: ${template.date_created}\n修改时间: ${template.date_modified}`)
        }
        response.push(h('text', { content: output.join('\n') }))
        return response
      } catch (err) {
        return autoRecall(session, `获取模板信息失败: ${err.message}`)
      }
    })
  meme.subcommand('.search <keyword:string>', '搜索模板表情')
    .usage('根据关键词搜索表情模板\n可搜索模板ID、关键词或标签')
    .example('memes.search 吃 - 搜索包含"吃"的表情模板')
    .action(async ({ session }, keyword) => {
      if (!keyword) return autoRecall(session, '请提供关键词')
      try {
        const results = await memeGenerator.matchTemplates(keyword)
        if (!results?.length) return autoRecall(session, `未找到有关"${keyword}"的表情模板`)
        const resultLines = results.map(t => {
          const keywords = Array.isArray(t.keywords) ? t.keywords.join(', ') : t.keywords || ''
          let line = `${keywords}(${t.id})`
          if (t.tags?.length) line += ` #${t.tags.join('#')}`
          return line
        })
        return `搜索结果（共${results.length}项）:\n${resultLines.join('\n')}`
      } catch (err) {
        return autoRecall(session, `搜索失败: ${err.message}`)
      }
    })
  meme.subcommand('.reload', '刷新模板缓存', { authority: 3 })
    .usage('刷新模板缓存，重新获取模板信息')
    .action(async ({ session }) => {
      try {
        const result = await memeGenerator.refreshCache()
        if (config.useMiddleware) keywordMap.clear()
        return `已刷新缓存文件（${result.length}项）`
      } catch (err) {
        return autoRecall(session, `刷新缓存失败：${err.message}`)
      }
    })

  /**
   * 关键词中间件
   * 实现直接通过关键词触发表情生成
   */
  if (config.useMiddleware) {
    ctx.on('message', async (session) => {
      if (keywordMap.size === 0) {
        keywordMap = memeGenerator.getAllKeywordMappings()
      }
      const rawContent = session.content
      if (!rawContent) return
      const elements = h.parse(rawContent)
      const firstTextElement = elements.find(el => el.type === 'text')
      if (!firstTextElement?.attrs?.content) return
      let content = firstTextElement.attrs.content.trim()
      // 检查前缀
      if (config.requirePrefix) {
        const prefixes = [].concat(ctx.root.config.prefix).filter(Boolean)
        if (prefixes.length) {
          const matched = prefixes.find(p => content.startsWith(p))
          if (!matched) return
          content = content.slice(matched.length).trim()
        }
      }
      // 提取关键词
      const spaceIndex = content.indexOf(' ')
      const key = spaceIndex === -1 ? content : content.substring(0, spaceIndex)
      const templateId = keywordMap.get(key)
      if (!templateId) return
      // 准备参数
      const paramElements = []
      if (spaceIndex !== -1) {
        const remainingText = content.substring(spaceIndex + 1).trim()
        if (remainingText) paramElements.push(h('text', { content: remainingText }))
      }
      // 添加其他元素
      elements.forEach(element => {
        if (element !== firstTextElement) paramElements.push(element)
      })
      await session.send(await memeGenerator.generateMeme(session, key, paramElements))
    })
  }

  // 注册内置模板命令
  if (config.loadInternal) {
    memeMaker.registerCommands(meme)
  }
  // 注册外部API命令
  if (config.loadApi) {
    new MemeAPI(ctx, logger).registerCommands(meme)
  }
}