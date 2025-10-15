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
 * @description 插件的配置项
 * @interface Config
 * @property {string} apiUrl - 后端 API 地址
 * @property {'disable' | 'noprefix' | 'prefix'} triggerMode - 关键词快捷触发模式
 */
export interface Config {
  apiUrl: string
  triggerMode: 'disable' | 'noprefix' | 'prefix'
}

/**
 * @description 配置项的 Schema，用于在 Koishi 的配置页面中显示
 */
export const Config: Schema<Config> = Schema.object({
  apiUrl: Schema.string().description('后端 API 地址').default('http://127.0.0.1:2233'),
  triggerMode: Schema.union([
    Schema.const('disable').description('关闭'),
    Schema.const('noprefix').description('无前缀'),
    Schema.const('prefix').description('有前缀'),
  ]).description('关键词快捷触发').default('disable'),
})

/**
 * @description 插件主入口函数。
 * @param {Context} ctx - Koishi 插件上下文
 * @param {Config} config - 插件配置
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const url = config.apiUrl.trim().replace(/\/+$/, '')

  const provider = new MemeProvider(ctx, url)
  const view = new View(ctx)

  const result = await provider.start()
  if (!result.success) return
  ctx.logger.info(`MemeGenerator 已加载: v${result.version}（模板数: ${result.count}）`)

  const cmd = ctx.command('memes', '表情生成').usage('通过 MemeGenerator API 生成表情')

  cmd.subcommand('.list [page:string]', '模板列表')
    .action(async ({}, pageStr) => {
      const list = await provider.getList()
      if (!list.length) return '模板列表为空'

      if (ctx.puppeteer) {
        try {
          const img = await view.listAsImage(list)
          return h.image(img, 'image/png')
        } catch (err) {
          ctx.logger.warn('图片渲染失败:', err)
        }
      }

      const page = parseInt(pageStr, 10) || 1
      return view.listAsText(list, page, 20)
    })

  cmd.subcommand('.make <key:string> [params:elements]', '表情生成')
    .action(async ({ session }, key, input) => {
      if (!key) return '请输入关键词'
      const item = await provider.getInfo(key)
      if (!item) return `模板 "${key}" 不存在`
      return provider.create(item.key, input || [], session)
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
          const img = await view.infoAsImage(item, data)
          return h.image(img, 'image/png')
        } catch (err) {
          ctx.logger.warn(`图片渲染失败:`, err)
        }
      }

      const reply: (h | string)[] = []
      if (preview instanceof Buffer) reply.push(h.image(preview, 'image/gif'))
      reply.push(view.infoAsText(item))
      return reply
    })

  cmd.subcommand('.search <key:string>', '搜索模板')
    .action(async ({}, key) => {
      if (!key) return '请输入关键词'
      const found = await provider.find(key)
      if (!found.length) return `无模板 "${key}" 相关结果`
      const text = found.map(t => ` - [${t.key}] ${t.keywords.join(', ')}`).join('\n')
      return `搜索结果（共${found.length}条）:\n${text}`
    })

  if (provider.isRsApi) provider.createToolCmds(cmd)

  if (config.triggerMode !== 'disable') {
    const globalPrefixes = Array.isArray(ctx.root.config.prefix) ? ctx.root.config.prefix : [ctx.root.config.prefix || '']

    ctx.middleware(async (session, next) => {
      let text = session.stripped.content.trim()
      if (!text) return next()

      if (config.triggerMode === 'prefix') {
        const prefix = globalPrefixes.find(p => text.startsWith(p))
        if (!prefix) return next()
        text = text.slice(prefix.length).trim()
      }

      const firstSpace = text.indexOf(' ')
      const key = firstSpace > 0 ? text.slice(0, firstSpace) : text
      const args = firstSpace > 0 ? text.slice(firstSpace + 1) : ''

      if (!key) return next()
      const item = await provider.getInfo(key, false)
      if (!item) return next()

      return session.execute(`meme.make ${key} ${args}`)
    }, true)
  }
}
