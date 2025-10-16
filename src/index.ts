import { Context, Schema, h } from 'koishi'
import { MemeInfo, MemeProvider } from './provider'

export const name = 'memes'

export const usage = `
<div style="border-radius: 10px; border: 1px solid #ddd; padding: 16px; margin-bottom: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
  <h2 style="margin-top: 0; color: #4a6ee0;">📌 插件说明</h2>
  <p>📖 <strong>使用文档</strong>：请点击左上角的 <strong>插件主页</strong> 查看插件使用文档</p>
  <p>🔍 <strong>更多插件</strong>：可访问 <a href="https://github.com/YisRime" style="color:#4a6ee0;text-decoration:none;">苡淞的 GitHub</a> 查看本人的所有插件</p>
</div>
<div style="border-radius: 10px; border: 1px solid #ddd; padding: 16px; margin-bottom: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
  <h2 style="margin-top: 0; color: #e0574a;">❤️ 支持与反馈</h2>
  <p>🌟 喜欢这个插件？请在 <a href="https://github.com/YisRime" style="color:#e0574a;text-decoration:none;">GitHub</a> 上给我一个 Star！</p>
  <p>🐛 遇到问题？请通过 <strong>Issues</strong> 提交反馈，或加入 QQ 群 <a href="https://qm.qq.com/q/PdLMx9Jowq" style="color:#e0574a;text-decoration:none;"><strong>855571375</strong></a> 进行交流</p>
</div>
`

/**
 * @interface Config
 * @description 插件的配置项接口。
 */
export interface Config {
  apiUrl: string
  cacheAllInfo: boolean
  triggerMode: 'disable' | 'noprefix' | 'prefix'
}

export const Config: Schema<Config> = Schema.object({
  apiUrl: Schema.string().description('后端 API 地址').default('http://127.0.0.1:2233'),
  cacheAllInfo: Schema.boolean().description('缓存模板详细信息').default(false),
  triggerMode: Schema.union([
    Schema.const('disable').description('关闭'),
    Schema.const('noprefix').description('无前缀'),
    Schema.const('prefix').description('有前缀'),
  ]).description('关键词触发方式').default('disable'),
})

/**
 * Koishi 插件的主入口函数。
 * @param ctx - Koishi 的上下文对象。
 * @param config - 用户提供的插件配置。
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const url = config.apiUrl.trim().replace(/\/+$/, '')
  const provider = new MemeProvider(ctx, url, config)

  try {
    const { version, count } = await provider.start()
    ctx.logger.info(`MemeGenerator 已加载: v${version}（模板数: ${count}）`)
  } catch (error) {
    ctx.logger.error(`MemeGenerator 未加载: ${error.message}`)
    return
  }

  const cmd = ctx.command('memes', '表情生成')
    .usage('通过 MemeGenerator API 生成表情')

  cmd.subcommand('.list', '模板列表')
    .action(async () => {
      const result = await provider.renderList()
      if (typeof result === 'string') return result
      return h.image(result, 'image/png')
    })

  cmd.subcommand('.make <keyOrKeyword:string> [params:elements]', '表情生成')
    .action(async ({ session }, keyOrKeyword, input) => {
      if (!keyOrKeyword) return '请输入关键词'
      return provider.create(keyOrKeyword, input ?? [], session)
    })

  cmd.subcommand('.info <keyOrKeyword:string>', '模板详情')
    .action(async ({}, keyOrKeyword) => {
      if (!keyOrKeyword) return '请输入关键词'
      const item = await provider.getInfo(keyOrKeyword)
      if (!item) return `模板 "${keyOrKeyword}" 不存在`

      const output: string[] = [`名称: ${item.keywords.join(', ') || item.key} (${item.key})`]
      if (item.tags?.length) output.push(`标签: ${item.tags.join(', ')}`)
      output.push('参数:', `  图片数: ${item.minImages}-${item.maxImages} 张`, `  文本数: ${item.minTexts}-${item.maxTexts} 条`)
      if (item.defaultTexts?.length) output.push(`  默认文本: ${item.defaultTexts.join(', ')}`)
      if (item.args?.length) output.push('额外参数:',
        ...item.args.map((arg) => {
          let desc = `  - ${arg.name} (${arg.type || 'any'})`
          if (arg.default !== undefined) desc += `, 默认: ${JSON.stringify(arg.default)}`
          if (arg.description) desc += `\n    描述: ${arg.description}`
          return desc
        }))
      if (item.shortcuts?.length) output.push('快捷指令:', ...item.shortcuts.map((sc) => `  - ${sc.humanized || sc.pattern}`))
      if (item.date_created) output.push(`创建时间: ${new Date(item.date_created).toLocaleString()}`)
      const textInfo = output.join('\n')

      const preview = await provider.getPreview(item.key)
      return h('message', preview instanceof Buffer ? h.image(preview, 'image/gif') : '', textInfo)
    })

  cmd.subcommand('.search <query:string>', '搜索模板')
    .action(async ({}, query) => {
      if (!query) return '请输入搜索关键词'
      const results = await provider.search(query)
      if (!results.length) return `"${query}" 无相关模板`

      let text: string
      if (results.every((r) => typeof r === 'string')) {
        text = (results as string[]).map((k) => ` - ${k}`).join('\n')
      } else {
        text = (results as MemeInfo[]).map((t) => ` - [${t.key}] ${t.keywords.join(', ')}`).join('\n')
      }

      return `搜索结果（共 ${results.length} 条）:\n${text}`
    })

  if (provider.isRsApi) {
    cmd.subcommand('.stat <title:string> <type:string> <data:string>', '数据统计')
      .usage('type=meme_count/time_count\ndata=key1:value1,key2:value2...')
      .action(async ({}, title, type, data) => {
        if (!title || !type || !data) return '输入参数不足'
        if (type !== 'meme_count' && type !== 'time_count') return '统计类型错误'

        const parsedData: [string, number][] = []
        for (const pair of data.split(',')) {
          const [key, value] = pair.split(':')
          if (!key || !value || isNaN(parseInt(value))) return `数据格式错误: "${pair}"`
          parsedData.push([key.trim(), parseInt(value.trim())])
        }

        const result = await provider.renderStatistics(title, type, parsedData)
        if (typeof result === 'string') return result
        return h.image(result, 'image/png')
      })

    cmd.subcommand('.img <image:img>', '图片处理')
      .option('hflip', '水平翻转')
      .option('vflip', '垂直翻转')
      .option('grayscale', '灰度化')
      .option('invert', '反色')
      .option('rotate', '-r, --rotate <degrees:number> 旋转图片')
      .option('resize', '--resize <size:string> 调整尺寸（宽|高）')
      .option('crop', '-c, --crop <box:string> 裁剪图片（左|上|右|下）')
      .action(async ({ options }, image) => {
        if (!image?.attrs?.src) return '请提供图片'
        const { src } = image.attrs
        const activeOps = Object.keys(options).filter((key) => key !== 'session')
        if (activeOps.length > 1) return '请仅指定一种操作'
        if (options.hflip) return provider.processImage('flip_horizontal', src)
        if (options.vflip) return provider.processImage('flip_vertical', src)
        if (options.grayscale) return provider.processImage('grayscale', src)
        if (options.invert) return provider.processImage('invert', src)
        if (options.rotate !== undefined) return provider.processImage('rotate', src, { degrees: options.rotate })
        if (options.resize) {
          const [width, height] = options.resize.split('|').map((s) => (s.trim() ? Number(s) : undefined))
          return provider.processImage('resize', src, { width, height })
        }
        if (options.crop) {
          const [left, top, right, bottom] = options.crop.split('|').map((s) => (s.trim() ? Number(s) : undefined))
          return provider.processImage('crop', src, { left, top, right, bottom })
        }
        return provider.processImage('inspect', src)
      })

    cmd.subcommand('.merge <images:elements>', '图片合并')
      .option('horizontal', '-h, --horizontal 水平合并')
      .option('vertical', '-v, --vertical 垂直合并')
      .option('gif', '-g, --gif [duration:number] 合并为 GIF', { fallback: 0.1 })
      .action(({ options }, images) => {
        const imgSrcs = images?.filter((el) => el?.type === 'img' && el?.attrs?.src).map((el) => el.attrs.src as string)
        if (!imgSrcs || imgSrcs.length < 2) return '请提供多张图片'
        const activeOps = Object.keys(options).filter((key) => key !== 'session')
        if (activeOps.length > 1) return '请仅指定一种操作'
        if (options.horizontal) return provider.processImages('merge_horizontal', imgSrcs)
        if (options.vertical) return provider.processImages('merge_vertical', imgSrcs)
        if (options.gif !== undefined) return provider.processImages('gif_merge', imgSrcs, { duration: options.gif })
        return '请指定操作'
      })

    cmd.subcommand('.merge <images:elements>', '图片合并')
      .option('horizontal', '-h, --horizontal 水平合并')
      .option('vertical', '-v, --vertical 垂直合并')
      .option('gif', '-g, --gif [duration:number] 合并为 GIF', { fallback: 0.1 })
      .action(({ options }, images) => {
        const imgSrcs = images?.filter((el) => el?.type === 'img' && el?.attrs?.src).map((el) => el.attrs.src as string)
        if (!imgSrcs || imgSrcs.length < 2) return '请提供多张图片'
        const activeOps = Object.keys(options).filter((key) => key !== 'session')
        if (activeOps.length > 1) return '请仅指定一种操作'
        if (options.horizontal) return provider.processImages('merge_horizontal', imgSrcs)
        if (options.vertical) return provider.processImages('merge_vertical', imgSrcs)
        if ('gif' in options) {
          const duration = typeof options.gif === 'number' ? options.gif : 0.1
          return provider.processImages('gif_merge', imgSrcs, { duration })
        }
        return '请指定操作'
      })
  }

  if (config.triggerMode !== 'disable') {
    const prefixes = Array.isArray(ctx.root.config.prefix)
      ? ctx.root.config.prefix
      : [ctx.root.config.prefix].filter(Boolean)
    ctx.middleware(async (session, next) => {
      let content = session.stripped.content.trim()
      if (!content) return next()

      if (config.triggerMode === 'prefix') {
        const prefix = prefixes.find((p) => content.startsWith(p))
        if (!prefix) return next()
        content = content.slice(prefix.length).trim()
      }

      const [keyOrKeyword, ...args] = content.split(/\s+/)
      if (provider.isTriggerable(keyOrKeyword)) return session.execute(`memes.make ${keyOrKeyword} ${args.join(' ')}`)
      return next()
    }, true)
  }
}
