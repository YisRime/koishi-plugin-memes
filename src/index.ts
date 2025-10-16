import { Context, Schema, h } from 'koishi'
import { MemeProvider } from './provider'
import { View } from './view'

export const inject = { optional: ['puppeteer'] }
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
 * 插件配置项接口
 */
export interface Config {
  apiUrl: string
  triggerMode: 'disable' | 'noprefix' | 'prefix'
}

/**
 * 插件配置项 Schema 定义
 */
export const Config: Schema<Config> = Schema.object({
  apiUrl: Schema.string().description('后端 API 地址').default('http://127.0.0.1:2233'),
  triggerMode: Schema.union([
    Schema.const('disable').description('关闭'),
    Schema.const('noprefix').description('无前缀'),
    Schema.const('prefix').description('有前缀'),
  ]).description('关键词触发方式').default('disable'),
})

/**
 * 插件的主入口函数
 * @param ctx - Koishi 的上下文对象
 * @param config - 插件的配置
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const url = config.apiUrl.trim().replace(/\/+$/, '')
  const provider = new MemeProvider(ctx, url)
  const view = new View(ctx)

  try {
    const { version, count } = await provider.start()
    ctx.logger.info(`MemeGenerator 已加载: v${version}（模板数: ${count}）`)
  } catch (error) {
    ctx.logger.error(`MemeGenerator 未加载: ${error.message}`)
    return
  }

  const cmd = ctx.command('memes', '表情生成')
    .usage('通过 MemeGenerator API 生成表情')

  cmd.subcommand('.list [page:number]', '模板列表')
    .action(async ({}, page = 1) => {
      const list = await provider.getList()
      if (!list.length) return '模板列表为空'

      if (ctx.puppeteer) {
        try {
          return h.image(await view.listAsImage(list), 'image/png')
        } catch (err) {
          ctx.logger.warn('图片渲染失败:', err)
        }
      }
      return view.listAsText(list, page, 20)
    })

  cmd.subcommand('.make <key:string> [params:elements]', '表情生成')
    .action(async ({ session }, key, input) => {
      if (!key) return '请输入关键词'
      return provider.create(key, input ?? [], session)
    })

  cmd.subcommand('.info <key:string>', '模板详情')
    .action(async ({}, key) => {
      if (!key) return '请输入关键词'
      const item = await provider.getInfo(key)
      if (!item) return `模板 "${key}" 不存在`
      const preview = await provider.getPreview(item.key)

      if (ctx.puppeteer) {
        try {
          const data = (preview instanceof Buffer) ? `data:image/gif;base64,${preview.toString('base64')}` : undefined
          return h.image(await view.infoAsImage(item, data), 'image/png')
        } catch (err) {
          ctx.logger.warn(`图片渲染失败:`, err)
        }
      }
      return h('message', (preview instanceof Buffer) ? h.image(preview, 'image/gif') : '', view.infoAsText(item))
    })

  cmd.subcommand('.search <key:string>', '搜索模板')
    .action(async ({}, key) => {
      if (!key) return '请输入搜索关键词'
      const found = await provider.find(key)
      if (!found.length) return `"${key}" 无相关模板`
      const text = found.map(t => ` - [${t.key}] ${t.keywords.join(', ')}`).join('\n')
      return `搜索结果（共 ${found.length} 条）:\n${text}`
    })

  if (provider.isRsApi) {
    cmd.subcommand('.img <image:img>', '图片处理')
      .option('hflip', '水平翻转')
      .option('vflip', '垂直翻转')
      .option('grayscale', '灰度化')
      .option('invert', '反色')
      .option('rotate', '-r, --rotate <degrees:number> 旋转图片')
      .option('resize', '--resize <size:string> 调整尺寸 (格式: 宽|高)')
      .option('crop', '-c, --crop <box:string> 裁剪图片 (格式: 左|上|右|下)')
      .action(async ({ options }, image) => {
        if (!image?.attrs?.src) return '请提供图片'
        const { src } = image.attrs

        const activeOps = Object.keys(options).filter(key => key !== 'session')
        if (activeOps.length > 1) return '请仅指定一种操作'

        if (options.hflip) return provider.processImage('flip_horizontal', src)
        if (options.vflip) return provider.processImage('flip_vertical', src)
        if (options.grayscale) return provider.processImage('grayscale', src)
        if (options.invert) return provider.processImage('invert', src)
        if (options.rotate !== undefined) return provider.processImage('rotate', src, { degrees: options.rotate })
        if (options.resize) {
          const [width, height] = options.resize.split('|').map(s => s.trim() ? Number(s) : undefined)
          return provider.processImage('resize', src, { width, height })
        }
        if (options.crop) {
          const [left, top, right, bottom] = options.crop.split('|').map(s => s.trim() ? Number(s) : undefined)
          return provider.processImage('crop', src, { left, top, right, bottom })
        }
        return provider.processImage('inspect', src)
      })

    cmd.subcommand('.gif <image:img>', 'GIF 处理')
      .option('split', '-s, --split 分解 GIF')
      .option('reverse', '-r, --reverse 倒放 GIF')
      .option('duration', '-d, --duration <duration:number> 调整帧间隔')
      .action(async ({ options }, image) => {
        if (!image?.attrs?.src) return '请提供图片'
        const { src } = image.attrs

        if (options.split) return provider.processImage('gif_split', src)
        if (options.reverse) return provider.processImage('gif_reverse', src)
        if (options.duration !== undefined) return provider.processImage('gif_change_duration', src, { duration: options.duration })
        return '请指定操作'
      })

    cmd.subcommand('.merge <images:elements>', '图片合并')
      .option('horizontal', '-h, --horizontal 水平合并')
      .option('vertical', '-v, --vertical 垂直合并')
      .option('gif', '-g, --gif [duration:number] 合并为 GIF')
      .action(({ options }, images) => {
        const imgSrcs = images?.filter(el => el?.type === 'img' && el?.attrs?.src).map(el => el.attrs.src as string)
        if (!imgSrcs || imgSrcs.length < 2) return '请提供多张图片'

        const activeOps = Object.keys(options).filter(key => key !== 'session')
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
    const prefixes = Array.isArray(ctx.root.config.prefix) ? ctx.root.config.prefix : [ctx.root.config.prefix].filter(Boolean)
    ctx.middleware(async (session, next) => {
      let content = session.stripped.content.trim()
      if (!content) return next()

      if (config.triggerMode === 'prefix') {
        const prefix = prefixes.find(p => content.startsWith(p))
        if (!prefix) return next()
        content = content.slice(prefix.length).trim()
      }

      const [key, ...args] = content.split(/\s+/)
      const item = await provider.getInfo(key, false)
      return item ? session.execute(`memes.make ${key} ${args.join(' ')}`) : next()
    }, true)
  }
}
