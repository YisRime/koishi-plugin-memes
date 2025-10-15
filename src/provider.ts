import { Context, h, Session, Command, Logger } from 'koishi'

/**
 * @description 参数解析标识配置
 * @interface ParserFlags
 * @property {boolean} [short] - 是否为短选项
 * @property {boolean} [long] - 是否为长选项
 * @property {string[]} [short_aliases] - 短选项别名
 * @property {string[]} [long_aliases] - 长选项别名
 */
export interface ParserFlags {
  short?: boolean
  long?: boolean
  short_aliases?: string[]
  long_aliases?: string[]
}

/**
 * @description 单个表情模板的参数选项
 * @interface MemeOption
 * @property {string} name - 选项名称
 * @property {string} type - 选项类型
 * @property {any} [default] - 默认值
 * @property {string | null} [description] - 选项描述
 * @property {ParserFlags} [parser_flags] - 参数解析标识配置
 * @property {(string | number)[] | null} [choices] - 可选值
 * @property {number | null} [minimum] - 最小值
 * @property {number | null} [maximum] - 最大值
 */
export interface MemeOption {
  name: string
  type: string
  default?: any
  description?: string | null
  parser_flags?: ParserFlags
  choices?: (string | number)[] | null
  minimum?: number | null
  maximum?: number | null
}

/**
 * @description 表情模板的快捷方式配置
 * @interface MemeShortcut
 * @property {string} pattern - 快捷方式的模式
 * @property {string | null} [humanized] - 人性化的快捷方式
 * @property {string[]} names - 名称
 * @property {string[]} texts - 文本
 * @property {Record<string, any>} options - 选项
 */
export interface MemeShortcut {
  pattern: string
  humanized?: string | null
  names: string[]
  texts: string[]
  options: Record<string, any>
}

/**
 * @description 表情模板的详细信息
 * @interface MemeInfo
 * @property {string} key - 模板的唯一标识
 * @property {string[]} keywords - 模板的关键词
 * @property {number} minImages - 最少需要的图片数量
 * @property {number} maxImages - 最多能接受的图片数量
 * @property {number} minTexts - 最少需要的文本数量
 * @property {number} maxTexts - 最多能接受的文本数量
 * @property {string[]} defaultTexts - 默认的文本
 * @property {MemeOption[]} args - 额外的参数选项
 * @property {string[]} [tags] - 模板的标签
 * @property {MemeShortcut[]} [shortcuts] - 快捷方式配置
 * @property {string} [date_created] - 创建日期
 * @property {string} [date_modified] - 修改日期
 */
export interface MemeInfo {
  key: string
  keywords: string[]
  minImages: number
  maxImages: number
  minTexts: number
  maxTexts: number
  defaultTexts: string[]
  args: MemeOption[]
  tags?: string[]
  shortcuts?: MemeShortcut[]
  date_created?: string
  date_modified?: string
}

/**
 * @description 获取用户的头像链接。
 * @param {Session} session - 当前会话对象
 * @param {string} [userId] - 目标用户 ID，如果未提供则使用当前会话的用户 ID
 * @returns {Promise<string>} - 头像的 URL 字符串
 */
export async function getAvatar(session: Session, userId?: string): Promise<string> {
  const targetId = userId || session.userId
  try {
    const user = await session.bot.getUser(targetId)
    if (user.avatar) return user.avatar
  } catch {}
  return `https://q1.qlogo.cn/g?b=qq&nk=${targetId}&s=640`
}

/**
 * @description 解析用户输入的 h 元素数组，分离出图片、文本和命令行参数。
 * @param {h[]} input - 用户输入的 h 元素数组
 * @param {Session} session - 当前会话对象
 * @returns {Promise<{ imgs: string[], texts: string[], args: Record<string, any> }>} - 解析后的图片链接、文本片段和参数对象
 */
export async function parseInput(input: h[], session: Session): Promise<{ imgs: string[], texts: string[], args: Record<string, any> }> {
  const imgs: string[] = []
  const texts: string[] = []
  const args: Record<string, any> = {}

  for (const el of input) {
    if (el.type === 'img' && el.attrs.src) {
      imgs.push(el.attrs.src)
    } else if (el.type === 'at' && el.attrs.id) {
      imgs.push(await getAvatar(session, el.attrs.id))
    } else if (el.type === 'text' && el.attrs.content) {
      el.attrs.content.trim().split(/\s+/).forEach(token => {
        if (!token) return
        const match = token.match(/^(-{1,2})([^=]+)=?(.*)$/)
        if (match) {
          const [, , key, value] = match
          args[key] = value || 'true'
        } else {
          texts.push(token)
        }
      })
    }
  }
  return { imgs, texts, args }
}

/**
 * @description Meme 服务提供者，负责与后端 API 交互，管理表情模板数据。
 * @class MemeProvider
 */
export class MemeProvider {
  public isRsApi: boolean = false
  private cache: MemeInfo[] = []
  private logger: Logger

  /**
   * @constructor
   * @param {Context} ctx - Koishi 的上下文对象
   * @param {string} url - 后端 API 的 URL
   */
  constructor(private ctx: Context, private url: string) {}

  /**
   * @description 启动并初始化 MemeProvider。
   * @returns {Promise<{ success: boolean, count?: number, version?: string, error?: string }>} - 一个包含 API 类型、模板数量和后端版本的对象
   */
  async start(): Promise<{ success: boolean, count?: number, version?: string, error?: string }> {
    try {
      const versionRaw = await this.ctx.http.get<string>(`${this.url}/meme/version`, { responseType: 'text' })
      const version = versionRaw.replace(/"/g, '')
      this.isRsApi = !version.startsWith('0.1.')
      const count = await this.fetch()
      return { success: true, count, version }
    } catch (error) {
      this.logger.error(`API 初始化失败: ${error.message}`)
      return { success: false }
    }
  }

  /**
   * @description 从后端 API 拉取最新的模板数据并更新缓存。
   * @returns {Promise<number>} - 缓存的模板总数
   */
  async fetch(): Promise<number> {
    try {
      this.cache = this.isRsApi ? await this.fetchRs() : await this.fetchFast()
      return this.cache.length
    } catch (e) {
      this.logger.error(`模板获取失败: ${e.message}`)
      return 0
    }
  }

  /**
   * @description 获取当前缓存的完整模板列表。
   * @returns {Promise<MemeInfo[]>} - 模板信息数组的 Promise
   */
  getList(): Promise<MemeInfo[]> {
    return Promise.resolve(this.cache)
  }

  /**
   * @description 根据关键词获取单个模板信息。
   * @param {string} key - 模板的 key 或关键词
   * @param {boolean} [fuzzy=true] - 是否启用模糊搜索，默认为 true
   * @returns {Promise<MemeInfo | null>} - 匹配到的第一个模板信息，或 null
   */
  async getInfo(key: string, fuzzy = true): Promise<MemeInfo | null> {
    if (!fuzzy) return this.cache.find(t => t.key === key || t.keywords.includes(key)) || null
    const results = await this.find(key)
    return results[0] || null
  }

  /**
   * @description 根据查询字符串搜索模板。
   * @param {string} query - 查询字符串
   * @returns {Promise<MemeInfo[]>} - 按优先级排序的匹配模板数组
   */
  async find(query: string): Promise<MemeInfo[]> {
    return this.cache
      .map(item => {
        let priority = 0
        if (item.key === query || item.keywords.includes(query)) priority = 5
        else if (item.keywords.some(k => k.includes(query))) priority = 4
        else if (item.key.includes(query)) priority = 3
        else if (this.isRsApi && item.tags?.some(t => t.includes(query))) priority = 2
        return { item, priority }
      })
      .filter(p => p.priority > 0)
      .sort((a, b) => b.priority - a.priority)
      .map(p => p.item)
  }

  /**
   * @description 获取模板的预览图。
   * @param {string} key - 模板的 key
   * @returns {Promise<Buffer | string>} - 包含预览图的 Buffer，或错误信息字符串
   */
  async getPreview(key: string): Promise<Buffer | string> {
    try {
      let previewUrl = `${this.url}/memes/${key}/preview`
      if (this.isRsApi) {
        const { image_id } = await this.ctx.http.get<{ image_id: string }>(`${this.url}/memes/${key}/preview`)
        previewUrl = `${this.url}/image/${image_id}`
      }
      const resp = await this.ctx.http.get<ArrayBuffer>(previewUrl, { responseType: 'arraybuffer' })
      return Buffer.from(resp)
    } catch (e) {
      this.logger.warn('图片获取失败:', e.message)
      return `图片获取失败: ${e}`
    }
  }

  /**
   * @description 创建表情包。
   * @param {string} key - 模板的 key
   * @param {h[]} input - 用户输入的 h 元素数组
   * @param {Session} session - 当前会话
   * @returns {Promise<h | string>} - 包含生成图片的 h 元素，或错误信息字符串
   */
  async create(key: string, input: h[], session: Session): Promise<h | string> {
    const item = await this.getInfo(key, false)
    let { imgs, texts, args } = await parseInput(input, session)

    if (this.isRsApi && imgs.length < item.minImages && item.minImages > 0) imgs.unshift(await getAvatar(session))

    if (imgs.length < item.minImages || imgs.length > item.maxImages) return `目前提供 ${imgs.length} 张图片，但需要 ${item.minImages}-${item.maxImages} 张`
    if (texts.length < item.minTexts || texts.length > item.maxTexts) return `目前提供 ${texts.length} 段文本，但需要 ${item.minTexts}-${item.maxTexts} 条`

    try {
      return this.isRsApi
        ? await this.createRs(key, imgs, texts, args)
        : await this.createFast(key, imgs, texts, args)
    } catch (e) {
      this.logger.warn('图片生成失败:', e.message)
      return `图片生成失败: ${e}`
    }
  }

  /**
   * @description 从 Rs-API 获取模板信息
   * @private
   * @returns {Promise<MemeInfo[]>} - 模板信息数组
   */
  private async fetchRs(): Promise<MemeInfo[]> {
    const data = await this.ctx.http.get<any[]>(`${this.url}/meme/infos`)
    return data.map(info => this.normRs(info)).filter(Boolean) as MemeInfo[]
  }

  /**
   * @description 格式化 Rs-API 的模板信息
   * @private
   * @param {any} data - 原始数据
   * @returns {MemeInfo | null} - 格式化后的模板信息
   */
  private normRs(data: any): MemeInfo | null {
    if (!data || !data.params) return null
    return {
      key: data.key,
      keywords: data.keywords || [],
      minImages: data.params.min_images,
      maxImages: data.params.max_images,
      minTexts: data.params.min_texts,
      maxTexts: data.params.max_texts,
      defaultTexts: data.params.default_texts || [],
      args: (data.params.options || []).map(opt => ({ ...opt })),
      tags: data.tags || [],
      shortcuts: data.shortcuts || [],
      date_created: data.date_created,
      date_modified: data.date_modified,
    }
  }

  /**
   * @description 上传图片到 Rs-API
   * @private
   * @param {Buffer} buf - 图片的 Buffer
   * @returns {Promise<string>} - 图片的 ID
   */
  private async upload(buf: Buffer): Promise<string> {
    const payload = { type: 'data', data: buf.toString('base64') }
    const { image_id } = await this.ctx.http.post<{ image_id: string }>(`${this.url}/image/upload`, payload)
    return image_id
  }

  /**
   * @description 使用 Rs-API 创建表情
   * @private
   * @param {string} key - 模板的 key
   * @param {string[]} imgs - 图片 URL 数组
   * @param {string[]} texts - 文本数组
   * @param {Record<string, any>} args - 参数对象
   * @returns {Promise<h>} - 包含生成图片的 h 元素
   */
  private async createRs(key: string, imgs: string[], texts: string[], args: Record<string, any>): Promise<h> {
    const imgBuffers = await Promise.all(imgs.map(url => this.ctx.http.get<ArrayBuffer>(url, { responseType: 'arraybuffer' })))
    const imgIds = await Promise.all(imgBuffers.map(buf => this.upload(Buffer.from(buf))))
    const payload = { images: imgIds.map(id => ({ id })), texts, options: args }
    const res = await this.ctx.http.post<{ image_id: string }>(`${this.url}/memes/${key}`, payload, { timeout: 30000 })
    const finalImg = await this.ctx.http.get<ArrayBuffer>(`${this.url}/image/${res.image_id}`, { responseType: 'arraybuffer' })
    return h.image(Buffer.from(finalImg), 'image/gif')
  }

  /**
   * @description 从 Fast-API 获取模板信息
   * @private
   * @returns {Promise<MemeInfo[]>} - 模板信息数组
   */
  private async fetchFast(): Promise<MemeInfo[]> {
    const keys = await this.ctx.http.get<string[]>(`${this.url}/memes/keys`)
    const results = await Promise.allSettled(keys.map(key => this.fetchFastInfo(key)))
    return results
      .filter(res => res.status === 'fulfilled' && res.value)
      .map(res => (res as PromiseFulfilledResult<MemeInfo>).value)
  }

  /**
   * @description 从 Fast-API 获取单个模板的详细信息
   * @private
   * @param {string} key - 模板的 key
   * @returns {Promise<MemeInfo | null>} - 模板信息
   */
  private async fetchFastInfo(key: string): Promise<MemeInfo | null> {
    for (let i = 0; i < 5; i++) {
      try {
        const data = await this.ctx.http.get<any>(`${this.url}/memes/${key}/info`, { timeout: 30000 })
        return this.normFast(data)
      } catch (error) {
        if (i < 5 - 1) {
          await new Promise(resolve => setTimeout(resolve, 30000))
        } else {
          this.logger.error(`模板 "${key}" 获取失败:`, error.message)
          return null
        }
      }
    }
    return null
  }

  /**
   * @description 格式化 Fast-API 的模板信息
   * @private
   * @param {any} data - 原始数据
   * @returns {MemeInfo | null} - 格式化后的模板信息
   */
  private normFast(data: any): MemeInfo | null {
    const params = data.params_type
    if (!data || !params) return null
    const args: MemeOption[] = []
    if (params.args_type?.args_model?.properties) {
      for (const [key, prop] of Object.entries(params.args_type.args_model.properties as Record<string, any>)) {
        if (key === 'user_infos') continue
        args.push({ name: key, type: prop.type, default: prop.default, description: prop.description, choices: prop.enum })
      }
    }
    return {
      key: data.key,
      keywords: data.keywords || data.aliases || [],
      minImages: params.min_images,
      maxImages: params.max_images,
      minTexts: params.min_texts,
      maxTexts: params.max_texts,
      defaultTexts: params.default_texts || [],
      args: args,
      tags: data.tags || [],
      shortcuts: (data.shortcuts || []).map(sc => ({ pattern: sc.key, humanized: sc.humanized, names: [], texts: [], options: { _raw_args: sc.args } })),
      date_created: data.date_created,
      date_modified: data.date_modified,
    }
  }

  /**
   * @description 使用 Fast-API 创建表情
   * @private
   * @param {string} key - 模板的 key
   * @param {string[]} imgs - 图片 URL 数组
   * @param {string[]} texts - 文本数组
   * @param {Record<string, any>} args - 参数对象
   * @returns {Promise<h>} - 包含生成图片的 h 元素
   */
  private async createFast(key: string, imgs: string[], texts: string[], args: Record<string, any>): Promise<h> {
    const form = new FormData()
    texts.forEach(t => form.append('texts', t))
    await Promise.all(imgs.map(async (url) => {
      const resp = await this.ctx.http.get(url, { responseType: 'arraybuffer' })
      form.append('images', new Blob([resp]))
    }))
    if (Object.keys(args).length) {
      form.append('args', JSON.stringify(args))
    }
    const result = await this.ctx.http.post<ArrayBuffer>(`${this.url}/memes/${key}/`, form, { responseType: 'arraybuffer', timeout: 30000 })
    return h.image(Buffer.from(result), 'image/gif')
  }

  /**
   * @description 创建图片处理工具相关的子指令。
   * @param {Command} cmd - `meme` 主指令实例
   */
  public createToolCmds(cmd: Command): void {
    cmd.subcommand('.tool <image:img>', '图片处理')
      .option('hflip', '- 水平翻转图片')
      .option('vflip', '- 垂直翻转图片')
      .option('grayscale', '- 灰度化图片')
      .option('invert', '- 反色图片')
      .option('reverse', '- 倒放 GIF')
      .action(async ({ options }, img) => {
      if (!img?.attrs.src) return '请提供图片'

      const endpointMap: Record<string, string> = {
        hflip: 'flip_horizontal', vflip: 'flip_vertical', grayscale: 'grayscale', invert: 'invert', reverse: 'gif_reverse',
      }

      const activeOptions = Object.keys(endpointMap).filter(key => options[key])

      if (activeOptions.length > 1 || activeOptions.length === 0) return '请仅指定一个处理选项'

      const endpoint = endpointMap[activeOptions[0]]

      try {
        const buf = await this.ctx.http.get(img.attrs.src, { responseType: 'arraybuffer' })
        const imgId = await this.upload(Buffer.from(buf))
        const res = await this.ctx.http.post<{ image_id: string }>(`${this.url}/tools/image_operations/${endpoint}`, { image_id: imgId })
        const finalBuf = await this.ctx.http.get(`${this.url}/image/${res.image_id}`, { responseType: 'arraybuffer' })
        return h.image(finalBuf, 'image/png')
      } catch (e) {
        this.logger.warn('图片处理失败:', e.message)
        return `图片处理失败: ${e}`
      }
    })
  }
}
