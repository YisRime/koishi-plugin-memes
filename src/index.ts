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
  useUserAvatar: boolean
  fillDefaultText: 'disable' | 'missing' | 'insufficient'
  ignoreExcess: boolean
  sortListBy?: 'key_asc' | 'key_desc' | 'keywords_asc' | 'keywords_desc' | 'keywords_pinyin_asc' | 'keywords_pinyin_desc' | 'date_created_asc' | 'date_created_desc' | 'date_modified_asc' | 'date_modified_desc'
  listTextTemplate?: string
  showListIcon?: boolean
  markAsNewDays?: number
  triggerMode: 'disable' | 'noprefix' | 'prefix'
  sendRandomInfo: boolean
  blacklist: {
    guildId: string
    keyId: string
  }[]
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    apiUrl: Schema.string().description('后端 API 地址').default('http://127.0.0.1:2233'),
    cacheAllInfo: Schema.boolean().description('缓存详细信息').default(true),
  }).description('基础配置'),
  Schema.object({
    useUserAvatar: Schema.boolean().description('自动补充用户头像').default(true),
    fillDefaultText: Schema.union([
      Schema.const('disable').description('关闭'),
      Schema.const('insufficient').description('自动'),
      Schema.const('missing').description('仅无文本'),
    ]).description('自动补充默认文本').default('missing'),
    ignoreExcess: Schema.boolean().description('自动忽略多余参数').default(true),
  }).description('参数配置'),
  Schema.object({
    triggerMode: Schema.union([
      Schema.const('disable').description('关闭'),
      Schema.const('noprefix').description('无前缀'),
      Schema.const('prefix').description('有前缀'),
    ]).description('关键词触发方式').default('disable'),
    sendRandomInfo: Schema.boolean().description('随机表情显示模板名').default(true),
    blacklist: Schema.array(Schema.object({
      guildId: Schema.string().description('群号'),
      keyId: Schema.string().description('模板名'),
    })).description('表情禁用规则').role('table'),
  }).description('其它配置'),
  Schema.object({
    sortListBy: Schema.union([
      Schema.const('key_asc').description('表情名 (升)'),
      Schema.const('key_desc').description('表情名 (降)'),
      Schema.const('keywords_asc').description('关键词 (升)'),
      Schema.const('keywords_desc').description('关键词 (降)'),
      Schema.const('keywords_pinyin_asc').description('关键词拼音 (升)'),
      Schema.const('keywords_pinyin_desc').description('关键词拼音 (降)'),
      Schema.const('date_created_asc').description('创建时间 (升)'),
      Schema.const('date_created_desc').description('创建时间 (降)'),
      Schema.const('date_modified_asc').description('修改时间 (升)'),
      Schema.const('date_modified_desc').description('修改时间 (降)'),
    ]).description('列表排序方式'),
    listTextTemplate: Schema.string().description('列表文字模板'),
    showListIcon: Schema.boolean().description('添加分类图标'),
    markAsNewDays: Schema.number().description('"新"标记天数'),
  }).description('菜单配置'),
])

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
    ctx.logger.info(`MemeGenerator v${version} 已加载（模板数: ${count}）`)
  } catch (error) {
    ctx.logger.error(`MemeGenerator 未加载: ${error}`)
    return
  }

  const cmd = ctx.command('memes', '表情生成')
    .usage('通过 MemeGenerator API 生成表情')

  cmd.subcommand('.list', '模板列表')
    .usage('显示所有可用的表情模板列表')
    .action(async ({ session }) => {
      const result = await provider.renderList(session)
      if (typeof result === 'string') return result
      return h.image(result, 'image/png')
    })

  cmd.subcommand('.make <keyOrKeyword:string> [params:elements]', '表情生成')
    .usage('根据模板名称或关键词制作表情')
    .action(async ({ session }, keyOrKeyword, input) => {
      if (!keyOrKeyword) return '请输入关键词'

      let targetKey: string
      let initialInput = input ?? []

      const shortcut = provider.findShortcut(keyOrKeyword, session)
      if (shortcut) {
        targetKey = shortcut.meme.key
        const argsString = shortcut.shortcutArgs.join(' ')
        const shortcutElements = h.parse(argsString)
        initialInput = [...shortcutElements, ...initialInput]
      } else {
        const item = await provider.getInfo(keyOrKeyword, session)
        if (!item) return `模板 "${keyOrKeyword}" 不存在`
        targetKey = item.key
      }

      try {
        return await provider.create(targetKey, initialInput, session)
      } catch (e) {
        if (e?.name === 'MissError') {
          await session.send(`${e.message}，请发送内容补充参数`)
          const response = await session.prompt(60000)
          if (!response) return '已取消生成'
          const combinedInput = [...initialInput, ...h.parse(response)]
          return provider.create(targetKey, combinedInput, session)
        }
      }
    })

  cmd.subcommand('.random [params:elements]', '随机表情')
    .usage('随机选择一个模板并制作表情')
    .action(async ({ session }, input) => {
      const initialInput = input ?? []

      for (let i = 0; i < 3; i++) {
        const item = await provider.getRandom(session)
        if (!item) return '无可用模板'

        try {
          const result = await provider.create(item.key, initialInput, session)
          if (config.sendRandomInfo) await session.send(`模板名: ${item.keywords.join('/') || item.key} (${item.key})`)
          return result
        } catch (e) {
          ctx.logger.warn('表情随机失败:', e)
          return `表情随机失败: ${e.message}`
        }
      }
    })

  cmd.subcommand('.info <keyOrKeyword:string>', '模板详情')
    .usage('查询指定表情模板的详细信息')
    .action(async ({ session }, keyOrKeyword) => {
      if (!keyOrKeyword) return '请输入关键词'
      const item = await provider.getInfo(keyOrKeyword, session)
      if (!item) return `模板 "${keyOrKeyword}" 不存在`

      const output: string[] = []
      output.push(`${item.keywords.join('/') || item.key} (${item.key})`)
      if (item.tags?.length) output.push(`标签: ${item.tags.join(', ')}`)

      const inputParts: string[] = []
      if (item.maxTexts > 0) {
          const textCount = item.minTexts === item.maxTexts ? item.minTexts : `${item.minTexts}-${item.maxTexts}`
          inputParts.push(`${textCount} 文本`)
      }
      if (item.maxImages > 0) {
          const imageCount = item.minImages === item.maxImages ? item.minImages : `${item.minImages}-${item.maxImages}`
          inputParts.push(`${imageCount} 图片`)
      }
      if (inputParts.length > 0) {
          let params_line = `参数: ${inputParts.join('，')}`
          if (item.defaultTexts?.length) params_line += ` [${item.defaultTexts.join(', ')}]`
          output.push(params_line)
      }
      if (item.args?.length) {
        output.push('选项:')
        for (const arg of item.args) {
          let line = `  - ${arg.name} (${arg.type || 'any'})`
          const details: string[] = []
          if (arg.default !== undefined && arg.default !== null && arg.default !== '') details.push(`[${JSON.stringify(arg.default).replace(/"/g, '')}]`)
          if (arg.choices?.length) details.push(`[${arg.choices.join(',')}]`)
          let details_str = details.join(' ')
          if (details_str) line += ` ${details_str}`
          if (arg.description) line += ` | ${arg.description}`
          output.push(line)
        }
      }
      if (item.shortcuts?.length) {
        output.push('快捷指令:')
        const shortcuts_list: string[] = []
        for (const sc of item.shortcuts) {
          const key = sc.humanized || sc.pattern || (sc as any).key
          let shortcutInfo = key
          const options = (sc as any).options
          if (options && Object.keys(options).length > 0) {
            const opts = Object.entries(options).map(([k, v]) => `${k}=${v}`).join(',')
            shortcutInfo += `(${opts})`
          } else {
            const args = (sc as any).args
            if (args && args.length > 0) shortcutInfo += `(${args.join(' ')})`
          }
          shortcuts_list.push(shortcutInfo)
        }
        for (let i = 0; i < shortcuts_list.length; i += 2) {
            const line = `  ${shortcuts_list[i]}${shortcuts_list[i + 1] ? ' | ' + shortcuts_list[i + 1] : ''}`
            output.push(line)
        }
      }

      const textInfo = output.join('\n')
      const preview = await provider.getPreview(item.key)
      return h('message', preview instanceof Buffer ? h.image(preview, 'image/gif') : '', textInfo)
    })

  cmd.subcommand('.search <query:string>', '搜索模板')
    .usage('根据关键词搜索相关的表情模板')
    .action(async ({ session }, query) => {
      if (!query) return '请输入搜索关键词'
      const results = await provider.search(query, session)
      if (!results.length) return `"${query}" 无相关模板`

      let text: string
      if (results.every((r) => typeof r === 'string')) {
        text = (results as string[]).map((k) => ` - ${k}`).join('\n')
      } else {
        text = (results as MemeInfo[]).map((t) => ` - [${t.key}] ${t.keywords.join(', ')}`).join('\n')
      }

      return `"${query}" 搜索结果（共 ${results.length} 条）:\n${text}`
    })

  if (provider.isRsApi) {
    cmd.subcommand('.stat <title:string> <type:string> <data:string>', '数据统计')
      .usage('类型为meme_count/time_count\n数据为key1:value1,key2:value2...')
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
      .usage('对单张图片进行处理')
      .option('hflip', '-hf, --hflip 水平翻转')
      .option('vflip', '-vf, --vflip 垂直翻转')
      .option('grayscale', '-g, --grayscale 灰度化')
      .option('invert', '-i, --invert 反色')
      .option('rotate', '-r, --rotate <degrees:number> 旋转图片')
      .option('resize', '-s, --resize <size:string> 调整尺寸 (宽|高)')
      .option('crop', '-c, --crop <box:string> 裁剪图片 (左|上|右|下)')
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

    cmd.subcommand('.gif <image:img>', 'GIF 处理')
      .usage('对单张 GIF 进行处理')
      .option('split', '-s, --split 分解 GIF')
      .option('reverse', '-r, --reverse 倒放 GIF')
      .option('duration', '-d, --duration <duration:number> 调整帧间隔', { fallback: 0.1 })
      .action(async ({ options }, image) => {
        if (!image?.attrs?.src) return '请提供图片'
        const { src } = image.attrs
        if (options.split) return provider.processImage('gif_split', src)
        if (options.reverse) return provider.processImage('gif_reverse', src)
        if (options.duration !== undefined) return provider.processImage('gif_change_duration', src, { duration: options.duration })
        return '请指定操作'
      })

    cmd.subcommand('.merge <images:elements>', '图片合并')
      .usage('合并多张图片为一张图片或 GIF')
      .option('horizontal', '-hz, --horizontal 水平合并')
      .option('vertical', '-vt, --vertical 垂直合并')
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
      const [word, ...args] = content.split(/\s+/)

      const item = await provider.getInfo(word, session)
      if (item) return session.execute(`memes.make ${content}`)

      const shortcut = provider.findShortcut(word, session)
      if (shortcut) {
        const shortcutArgsString = shortcut.shortcutArgs.join(' ')
        const userArgsString = args.join(' ')
        return session.execute(`memes.make ${shortcut.meme.key} ${shortcutArgsString} ${userArgsString}`)
      }
      return next()
    }, true)
  }
}
