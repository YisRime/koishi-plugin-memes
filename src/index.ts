import { Context, Schema, h, Logger } from 'koishi'
import { MemeAPI } from './api'
import { MemeMaker } from './make'
import { MemeGenerator } from './generator'

export const name = 'memes'
export const inject = {optional: ['puppeteer']}
export const logger = new Logger('memes')

export interface Config {
  loadApi: boolean
  genUrl: string
}

export const Config: Schema<Config> = Schema.object({
  loadApi: Schema.boolean()
    .description('开启自定义 API 生成功能').default(false),
  genUrl: Schema.string()
    .description('MemeGenerator API 配置').default('http://localhost:2233')
})

/**
 * 插件主函数
 */
export function apply(ctx: Context, config: Config) {
  const apiUrl = !config.genUrl ? '' : config.genUrl.trim().replace(/\/+$/, '')
  const memeGenerator = new MemeGenerator(ctx, logger, apiUrl)
  const memeMaker = new MemeMaker(ctx, memeGenerator)

  const meme = ctx.command('memes [key:string] [...texts:text]', '制作表情包')
    .usage('输入类型并补充对应参数来生成对应表情\n使用"-xx"提供参数，"@用户"提供用户头像\n请使用"."触发子指令，如"memes.list"')
    .example('memes ba_say -character=1 -position=right 你好 - 生成带参数的"心奈"说"你好"的表情')
    .example('memes eat @用户 - 使用指定用户头像生成"吃"表情')
    .action(async ({ session }, key, ...args) => {
      if (!key) {
        return memeGenerator.autoRecall(session, '请提供模板ID和文本参数')
      }
      return memeGenerator.generateMeme(session, key, args.map(arg => h('text', { content: arg })))
    })
  meme.subcommand('.list [page:string]', '列出可用模板列表')
    .usage('输入页码查看列表或使用"all"查看所有模板')
    .example('memes.list - 查看第一页模板列表')
    .example('memes.list all - 查看所有模板列表')
    .action(async ({ session }, page) => {
      const result = await memeGenerator.getMemeList(page)
      if (!result) {
        return memeGenerator.autoRecall(session, `获取模板列表失败`)
      }
      const { totalTemplates, displayLines, totalPages, validPage, showAll } = result
      const header = showAll
        ? `表情模板列表（共${totalTemplates}个）\n`
        : totalPages > 1
          ? `表情模板列表（${validPage}/${totalPages}页）\n`
          : `表情模板列表（共${totalTemplates}个）\n`
      return header + displayLines.join('\n')
    })
  meme.subcommand('.info [key:string]', '获取模板详细信息')
    .usage('查看指定模板的详细信息和参数')
    .example('memes.info ba_say - 查看"ba_say"模板的详细信息和参数')
    .example('memes.info 吃 - 查看"吃"模板的详细信息和参数')
    .action(async ({ session }, key) => {
      if (!key) {
        return memeGenerator.autoRecall(session, '请提供模板ID或关键词')
      }
      const result = await memeGenerator.getMemeInfo(key)
      if (!result) {
        return memeGenerator.autoRecall(session, `未找到模板: ${key}`)
      }
      const { info, previewImage, templateId } = result
      const keywords = Array.isArray(info.keywords) ? info.keywords : [info.keywords].filter(Boolean)
      // 标题信息
      let headerLines = []
      headerLines.push(`模板"${keywords.join(', ')}(${templateId})"详细信息:`)
      const detailLines = []
      const pt = info.params_type || {}
      // 参数需求
      if (info.tags?.length) headerLines.push(`标签: ${info.tags.join(', ')}`)
      detailLines.push('需要参数:')
      detailLines.push(`- 图片: ${pt.min_images || 0}${pt.max_images !== pt.min_images ? `-${pt.max_images}` : ''}张`)
      detailLines.push(`- 文本: ${pt.min_texts || 0}${pt.max_texts !== pt.min_texts ? `-${pt.max_texts}` : ''}条`)
      if (pt.default_texts?.length) detailLines.push(`- 默认文本: ${pt.default_texts.join(', ')}`)
      // 其他参数
      if (pt.args_type?.args_model?.properties) {
        detailLines.push('其他参数:')
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
          detailLines.push(propDesc)
        }
        // 展示类型定义
        if (Object.keys(definitions).length > 0) {
          detailLines.push('类型定义:')
          for (const typeName in definitions) {
            detailLines.push(`- ${typeName}:`)
            const typeDef = definitions[typeName]
            if (typeDef.properties) {
              for (const propName in typeDef.properties) {
                const prop = typeDef.properties[propName]
                let propDesc = `  • ${propName}`
                if (prop.type) propDesc += ` (${prop.type})`
                if (prop.default !== undefined) propDesc += ` 默认值: ${JSON.stringify(prop.default)}`
                if (prop.description) propDesc += ` - ${prop.description}`
                if (prop.enum?.length) propDesc += ` [可选值: ${prop.enum.join(', ')}]`
                detailLines.push(propDesc)
              }
            }
          }
        }
      }
      // 命令行参数
      if (pt.args_type?.parser_options?.length) {
        detailLines.push('命令行参数:')
        pt.args_type.parser_options.forEach(opt => {
          const names = opt.names.join(', ')
          const argInfo = opt.args?.length ?
            opt.args.map(arg => {
              let argDesc = arg.name
              if (arg.value) argDesc += `:${arg.value}`
              if (arg.default !== null && arg.default !== undefined) argDesc += `=${arg.default}`
              return argDesc
            }).join(' ') : ''
          detailLines.push(`- ${names} ${argInfo}${opt.help_text ? ` - ${opt.help_text}` : ''}`)
        })
      }
      // 参数示例和快捷指令
      if (pt.args_type?.args_examples?.length) {
        detailLines.push('参数示例:')
        pt.args_type.args_examples.forEach((example, i) => {
          detailLines.push(`- 示例${i+1}: ${JSON.stringify(example)}`)
        })
      }
      if (info.shortcuts?.length) {
        detailLines.push('快捷指令:')
        info.shortcuts.forEach(shortcut => {
          detailLines.push(`- ${shortcut.humanized || shortcut.key}${shortcut.args?.length ? ` (参数: ${shortcut.args.join(' ')})` : ''}`)
        })
      }
      // 时间信息
      if (info.date_created || info.date_modified) {
        detailLines.push(`创建时间: ${info.date_created}\n修改时间: ${info.date_modified}`)
      }
      // 返回文本信息和预览图
      if (previewImage) {
        const base64 = Buffer.from(previewImage).toString('base64')
        return [
          h('text', { content: headerLines.join('\n') }),
          h('image', { url: `data:image/png;base64,${base64}` }),
          h('text', { content: '\n' + detailLines.join('\n') })
        ];
      }
      // 没有预览图时返回完整文本
      return [...headerLines, ...detailLines].join('\n');
    })
  meme.subcommand('.search <keyword:string>', '搜索表情模板')
    .usage('根据关键词搜索表情模板')
    .example('memes.search 吃 - 搜索包含"吃"关键词的表情模板')
    .action(async ({ session }, keyword) => {
      if (!keyword) {
        return memeGenerator.autoRecall(session, '请提供搜索关键词')
      }
      const results = await memeGenerator.searchMeme(keyword)
      if (!results || results.length === 0) {
        return `未找到表情模板"${keyword}"`
      }
      const resultLines = results.map(t => {
        let line = `${t.id}`
        if (t.keywords?.length > 0) {
          line += `|${t.keywords.join(',')}`
        }
        if (t.tags?.length > 0) {
          line += ` #${t.tags.join(' #')}`
        }
        return line
      })
      return `搜索结果（共${results.length}项）:\n` + resultLines.join('\n')
    })
  meme.subcommand('.refresh', '刷新表情模板缓存', { authority: 3 })
    .usage('手动刷新表情模板缓存数据')
    .action(async ({ session }) => {
      try {
        const result = await memeGenerator.refreshCache()
        return `已刷新缓存文件：${result.length}项`
      } catch (err) {
        logger.error(`刷新缓存失败: ${err.message}`)
        return memeGenerator.autoRecall(session, `刷新缓存失败：${err.message}`)
      }
    })

  // 注册图片生成相关命令
  memeMaker.registerCommands(meme)
  // 初始化并注册外部API命令
  if (config.loadApi) {
    const externalApi = new MemeAPI(ctx, logger, memeGenerator)
    externalApi.registerCommands(meme)
  }
}