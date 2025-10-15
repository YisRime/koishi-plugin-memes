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
 * @interface Config
 * @description 插件的配置项接口。
 * @property {string} apiUrl - meme 生成后端的 API 地址。
 * @property {boolean} useMiddleware - 是否启用关键词中间件。
 * @property {string} commandPrefix - 中间件模式下的触发前缀。
 */
export interface Config {
  apiUrl: string
  useMiddleware: boolean
  commandPrefix: string
}

/** Koishi 插件的配置项 Schema 定义。 */
export const Config: Schema<Config> = Schema.object({
  apiUrl: Schema.string().description('后端 API 地址').default('http://127.0.0.1:2233'),
  useMiddleware: Schema.boolean().description('开启关键词触发').default(false),
  commandPrefix: Schema.string().description('关键词触发前缀').default('.'),
})

/**
 * Koishi 插件的主应用函数 (apply)。
 * @param {Context} ctx - Koishi 的上下文对象。
 * @param {Config} config - 用户提供的插件配置。
 * @returns {Promise<void>}
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const url = config.apiUrl.trim().replace(/\/+$/, '')
  const provider = new MemeProvider(ctx, url)
  const view = new View(ctx)

  const startError = await provider.start()
  if (startError) {
    ctx.logger.error(`Meme 服务启动失败: ${startError}`)
    return
  }

  ctx.logger.info(`Meme 服务启动成功。后端模式: ${provider.isRsApi ? 'rs-api' : 'FastAPI'}`)

  createCmds(ctx, provider, view)
  if (config.useMiddleware) createHook(ctx, config, provider)
}

/**
 * 注册所有与 meme 相关的命令。
 * @param {Context} ctx - Koishi 的上下文对象。
 * @param {MemeProvider} provider - MemeProvider 的实例。
 * @param {View} view - View 的实例。
 * @returns {void}
 */
function createCmds(ctx: Context, provider: MemeProvider, view: View): void {
  const cmd = ctx.command('meme', '表情生成').usage('通过 MemeGenerator API 生成表情')

  cmd.subcommand('.list [page:string]', '查看可用表情模板列表')
    .action(async ({ session }, pageStr) => {
      const list = await provider.getList()
      if (!list.length) return '模板列表为空'

      if (ctx.puppeteer) {
        try {
          const img = await view.listAsImage(list)
          return h.image(img, 'image/png')
        } catch (err) {
          ctx.logger.warn('渲染模板列表为图片失败，将回退到文本模式。', err)
        }
      }

      const page = parseInt(pageStr, 10) || 1
      return view.listAsText(list, page, 20)
    })

  cmd.subcommand('.make <key:string> [params:elements]', '生成表情')
    .action(async ({ session }, key, input) => {
      if (!key) return '请输入要制作的表情包关键词。'

      const item = await provider.getInfo(key)
      if (!item) return `未找到与 “${key}” 相关的表情包模板。`

      return provider.create(item.key, input || [], session)
    })

  cmd.subcommand('.info <key:string>', '查看表情模板详情')
    .action(async ({}, key) => {
      if (!key) return '请输入要查询的表情包关键词。'
      const item = await provider.getInfo(key)
      if (!item) return `未找到表情包模板 “${key}”。`

      const preview = await provider.getPreview(item.key)
      if (typeof preview === 'string') {
        ctx.logger.warn(`获取 “${key}” 的预览图失败。`)
      }

      if (ctx.puppeteer) {
        try {
          const data = (preview instanceof Buffer) ? `data:image/gif;base64,${preview.toString('base64')}` : undefined
          const img = await view.infoAsImage(item, data)
          return h.image(img, 'image/png')
        } catch (err) {
          ctx.logger.warn(`为 '${key}' 渲染模板详情失败，将回退到文本模式。`, err)
        }
      }

      const reply: (h | string)[] = []
      if (preview instanceof Buffer) reply.push(h.image(preview, 'image/gif'))
      reply.push(view.infoAsText(item))
      return reply
    })

  cmd.subcommand('.search <keyword:string>', '搜索表情模板')
    .action(async ({}, query) => {
      if (!query) return '请输入搜索关键词。'
      const found = await provider.find(query)
      if (!found.length) return `未找到与 “${query}” 相关的表情包模板。`
      const text = found.slice(0, 30).map(t => ` - [${t.key}] ${t.keywords.join(', ')}`).join('\n')
      return `搜索结果 (共 ${found.length} 条，显示前 30 条):\n${text}`
    })

  if (provider.isRsApi) {
    provider.createToolCmds(cmd)
  }
}

/**
 * 注册中间件，用于实现通过关键词直接触发表情制作。
 * @param {Context} ctx - Koishi 的上下文对象。
 * @param {Config} config - 插件配置。
 * @param {MemeProvider} provider - MemeProvider 的实例。
 * @returns {void}
 */
function createHook(ctx: Context, config: Config, provider: MemeProvider): void {
  ctx.middleware(async (session, next) => {
    const text = session.stripped.content.trim()
    const prefix = config.commandPrefix || ''

    if (!prefix && !text) return next()
    if (prefix && !text.startsWith(prefix)) return next()

    const cmdText = text.slice(prefix.length)
    const key = cmdText.split(/\s/)[0]
    if (!key) return next()

    const item = await provider.getInfo(key, false)
    if (!item) return next()

    return session.execute(`meme.make ${cmdText}`)
  }, true)
}
