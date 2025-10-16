import { Context, h, Session, Logger } from 'koishi'

/**
 * 解析器标志位配置
 */
export interface ParserFlags {
  short?: boolean
  long?: boolean
  short_aliases?: string[]
  long_aliases?: string[]
}

/**
 * 表情模板选项配置
 */
export interface MemeOption {
  name: string
  type: string
  default?: any
  description?: string | null
  parser_flags?: ParserFlags
  choices?: (string | number)[] | null
}

/**
 * 表情模板快捷方式配置
 */
export interface MemeShortcut {
  pattern: string
  humanized?: string | null
}

/**
 * 表情模板的完整信息结构
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
}

/**
 * 从用户会话中获取头像 URL
 * @param session - 当前 Koishi 会话对象
 * @param userId - (可选) 目标用户 ID，如果未提供则使用会话发起者的 ID
 * @returns 返回一个包含头像 URL 的 Promise<string>
 */
async function getAvatar(session: Session, userId?: string): Promise<string> {
  const targetId = userId || session.userId
  try {
    const user = await session.bot.getUser(targetId)
    if (user.avatar) return user.avatar
  } catch {}
  return `https://q1.qlogo.cn/g?b=qq&nk=${targetId}&s=640`
}

/**
 * MemeProvider 类，负责与后端 API 交互，管理表情模板的获取、生成和处理
 */
export class MemeProvider {
  public isRsApi: boolean = false
  private cache: MemeInfo[] = []
  private logger: Logger

  /**
   * MemeProvider 构造函数
   * @param ctx - Koishi 的上下文对象
   * @param url - 后端 API 的地址
   */
  constructor(private ctx: Context, public url: string) {
    this.logger = ctx.logger('memes')
  }

  /**
   * 启动并初始化 Provider
   * @returns 返回一个包含版本号和模板总数的对象
   */
  async start(): Promise<{ version: string, count: number }> {
    const versionRaw = await this.ctx.http.get<string>(`${this.url}/meme/version`, { responseType: 'text' })
    const version = versionRaw.replace(/"/g, '')
    this.isRsApi = !version.startsWith('0.1.')
    const count = await this.fetch()
    return { version, count }
  }

  /**
   * 从后端 API 拉取并缓存所有表情模板信息
   * @returns 返回获取到的模板总数
   */
  async fetch(): Promise<number> {
    if (this.isRsApi) {
      const data = await this.ctx.http.get<any[]>(`${this.url}/meme/infos`)
      this.cache = data.map(info => ({
        key: info.key,
        keywords: info.keywords || [],
        minImages: info.params.min_images,
        maxImages: info.params.max_images,
        minTexts: info.params.min_texts,
        maxTexts: info.params.max_texts,
        defaultTexts: info.params.default_texts || [],
        args: (info.params.options || []).map(opt => ({ ...opt })),
        tags: info.tags || [],
        shortcuts: info.shortcuts || [],
        date_created: info.date_created,
      }))
    } else {
      const keys = await this.ctx.http.get<string[]>(`${this.url}/memes/keys`)
      const results = await Promise.allSettled(keys.map(key =>
        this.ctx.http.get<any>(`${this.url}/memes/${key}/info`, { timeout: 30000 })
      ))
      this.cache = results
        .filter((res): res is PromiseFulfilledResult<any> => res.status === 'fulfilled' && res.value)
        .map(res => {
          const data = res.value
          const params = data.params_type
          return {
            key: data.key,
            keywords: data.keywords || [],
            minImages: params.min_images,
            maxImages: params.max_images,
            minTexts: params.min_texts,
            maxTexts: params.max_texts,
            defaultTexts: params.default_texts || [],
            args: Object.entries(params.args_type?.args_model?.properties || {})
              .filter(([key]) => key !== 'user_infos')
              .map(([key, prop]: [string, any]) => ({
                name: key,
                type: prop.type,
                default: prop.default,
                description: prop.description,
              })),
            tags: data.tags || [],
            shortcuts: data.shortcuts || [],
            date_created: data.date_created,
          }
        })
    }
    return this.cache.length
  }

  /**
   * 获取缓存的完整模板列表
   * @returns 返回一个包含所有 MemeInfo 对象的数组
   */
  getList = () => Promise.resolve(this.cache)

  /**
   * 根据关键词获取单个模板信息
   * @param key - 模板的 key 或关键词
   * @param fuzzy - (可选, 默认true) 是否启用模糊搜索
   * @returns 返回找到的 MemeInfo 对象，如果找不到则返回 null
   */
  getInfo = async (key: string, fuzzy = true): Promise<MemeInfo | null> => {
    const directMatch = this.cache.find(t => t.key === key || t.keywords.includes(key))
    if (!fuzzy || directMatch) return directMatch || null
    const results = await this.find(key)
    return results[0] || null
  }

  /**
   * 根据查询字符串在缓存中搜索模板
   * @param query - 搜索关键词
   * @returns 返回一个按优先级排序的 MemeInfo 数组
   */
  find = async (query: string): Promise<MemeInfo[]> => {
    return this.cache
      .map(item => {
        let priority = 0
        if (item.key === query || item.keywords.includes(query)) priority = 5
        else if (item.keywords.some(k => k.includes(query))) priority = 4
        else if (item.key.includes(query)) priority = 3
        else if (item.tags?.some(t => t.includes(query))) priority = 2
        return { item, priority }
      })
      .filter(p => p.priority > 0)
      .sort((a, b) => b.priority - a.priority)
      .map(p => p.item)
  }

  /**
   * 获取指定模板的预览图
   * @param key - 模板的 key
   * @returns 返回一个包含图片 Buffer 的 Promise，或者在失败时返回错误信息的字符串
   */
  async getPreview(key: string): Promise<Buffer | string> {
    try {
      let previewUrl = `${this.url}/memes/${key}/preview`
      if (this.isRsApi) {
        const { image_id } = await this.ctx.http.get<{ image_id: string }>(`${this.url}/memes/${key}/preview`)
        previewUrl = `${this.url}/image/${image_id}`
      }
      return Buffer.from(await this.ctx.http.get<ArrayBuffer>(previewUrl, { responseType: 'arraybuffer' }))
    } catch (e) {
      this.logger.warn(`预览图 "${key}" 获取失败:`, e.message)
      return `预览图获取失败: ${e.message}`
    }
  }

  /**
   * 根据输入创建表情图片
   * @param key - 模板的 key
   * @param input - Koishi 的 h 元素数组，包含图片和文本
   * @param session - 当前 Koishi 会话对象
   * @returns 返回一个包含生成图片的 h 元素，或在失败时返回错误信息的字符串
   */
  async create(key: string, input: h[], session: Session): Promise<h | string> {
    const item = await this.getInfo(key, true)
    if (!item) return `模板 "${key}" 不存在`

    const imgs: string[] = []
    const texts: string[] = []
    const args: Record<string, any> = {}
    for (const el of input) {
      if (el.type === 'img' && el.attrs.src) imgs.push(el.attrs.src)
      else if (el.type === 'at' && el.attrs.id) imgs.push(await getAvatar(session, el.attrs.id))
      else if (el.type === 'text' && el.attrs.content) {
        el.attrs.content.trim().split(/\s+/).forEach(token => {
          if (!token) return
          const match = token.match(/^(-{1,2})([^=]+)=?(.*)$/)
          match ? args[match[2]] = match[3] || true : texts.push(token)
        })
      }
    }

    // 未提供图片自动使用用户头像
    if (imgs.length < item.minImages && item.minImages > 0) imgs.unshift(await getAvatar(session))
    // 校验图片和文本数量
    if (imgs.length < item.minImages || imgs.length > item.maxImages) return `现有 ${imgs.length} 张图片，但需要 ${item.minImages}-${item.maxImages} 张`
    if (texts.length < item.minTexts || texts.length > item.maxTexts) return `现有 ${texts.length} 条文本，但需要 ${item.minTexts}-${item.maxTexts} 条`

    try {
      if (this.isRsApi) {
        const imgBuffers = await Promise.all(imgs.map(url => this.ctx.http.get<ArrayBuffer>(url, { responseType: 'arraybuffer' })))
        const imgIds = await Promise.all(imgBuffers.map(buf => this.upload(Buffer.from(buf))))
        const payload = { images: imgIds.map(id => ({ id })), texts, options: args }
        const res = await this.ctx.http.post<{ image_id: string }>(`${this.url}/memes/${key}`, payload, { timeout: 30000 })
        const finalImg = await this.ctx.http.get<ArrayBuffer>(`${this.url}/image/${res.image_id}`, { responseType: 'arraybuffer' })
        return h.image(Buffer.from(finalImg), 'image/gif')
      } else {
        const form = new FormData()
        texts.forEach(t => form.append('texts', t))
        await Promise.all(imgs.map(async (url) => {
          const resp = await this.ctx.http.get(url, { responseType: 'arraybuffer' })
          form.append('images', new Blob([resp]))
        }))
        if (Object.keys(args).length) form.append('args', JSON.stringify(args))
        const result = await this.ctx.http.post<ArrayBuffer>(`${this.url}/memes/${key}/`, form, { responseType: 'arraybuffer', timeout: 30000 })
        return h.image(Buffer.from(result), 'image/gif')
      }
    } catch (e) {
      this.logger.warn(`图片生成失败 (${item.key}):`, e.message)
      return `图片生成失败: ${e.message}`
    }
  }

  /**
   * 调用后端 API 对单张图片进行处理
   * @param endpoint - API 的端点名称
   * @param imageUrl - 要处理的图片的 URL
   * @param payload - (可选) 附加的请求体数据
   * @returns 返回处理结果，可能是包含图片的 h 元素或文本信息
   */
  async processImage(endpoint: string, imageUrl: string, payload: any = {}): Promise<h | string> {
    try {
      const buf = await this.ctx.http.get(imageUrl, { responseType: 'arraybuffer' })
      const image_id = await this.upload(Buffer.from(buf))
      const finalPayload = { ...payload, image_id }

      if (endpoint === 'inspect') {
        const info = await this.ctx.http.post<any>(`${this.url}/tools/image_operations/inspect`, finalPayload)
        let result = `图片信息:\n- 尺寸: ${info.width}x${info.height}`
        result += info.is_multi_frame
          ? `\n- 类型: GIF (${info.frame_count} 帧)`
          : '\n- 类型: 图片'
        return result
      }

      if (endpoint === 'gif_split') {
        const res = await this.ctx.http.post<{ image_ids: string[] }>(`${this.url}/tools/image_operations/gif_split`, finalPayload)
        if (!res.image_ids?.length) return 'GIF 分解失败'
        const mergedBuffer = await this.performMerge(res.image_ids, 'merge_horizontal', {})
        return h('message', `GIF (${res.image_ids.length}帧)分解成功`, h.image(mergedBuffer, 'image/png'))
      }

      const res = await this.ctx.http.post<{ image_id: string }>(`${this.url}/tools/image_operations/${endpoint}`, finalPayload)
      const finalBuf = await this.ctx.http.get(`${this.url}/image/${res.image_id}`, { responseType: 'arraybuffer' })
      return h.image(Buffer.from(finalBuf), 'image/png')
    } catch (e) {
      this.logger.warn(`图片 "${endpoint}" 处理失败:`, e.message)
      return `图片处理失败: ${e.message}`
    }
  }

  /**
   * 调用后端 API 对多张图片进行处理
   * @param endpoint - API 的端点名称
   * @param sources - 包含多个图片 URL 的数组
   * @param payload - (可选) 附加的请求体数据
   * @returns 返回处理后的图片 h 元素，或错误信息
   */
  async processImages(endpoint: string, sources: string[], payload: any = {}): Promise<h | string> {
    try {
      const image_ids = await Promise.all(
        sources.map(url => this.ctx.http.get<ArrayBuffer>(url, { responseType: 'arraybuffer' })
          .then(buf => this.upload(Buffer.from(buf))))
      )
      const finalBuf = await this.performMerge(image_ids, endpoint, payload)
      return h.image(finalBuf, 'image/png')
    } catch (e) {
      this.logger.warn(`图片 "${endpoint}" 处理失败:`, e.message)
      return `图片处理失败: ${e.message}`
    }
  }

  /**
   * 用于请求图片合并端点并返回结果 Buffer
   * @param image_ids - 已上传的图片 ID 列表
   * @param endpoint - API 的端点名称
   * @param payload - 附加的请求体数据
   * @returns 返回包含合并后图片的 Buffer
   */
  private async performMerge(image_ids: string[], endpoint: string, payload: any): Promise<Buffer> {
    const finalPayload = { ...payload, image_ids }
    const res = await this.ctx.http.post<{ image_id: string }>(`${this.url}/tools/image_operations/${endpoint}`, finalPayload)
    const finalBuf = await this.ctx.http.get(`${this.url}/image/${res.image_id}`, { responseType: 'arraybuffer' })
    return Buffer.from(finalBuf)
  }

  /**
   * @zh
   * 将图片 Buffer 上传到后端 API。
   * @param buf - 包含图片数据的 Buffer
   * @returns 返回上传后得到的 image_id
   */
  private async upload(buf: Buffer): Promise<string> {
    const payload = { type: 'data', data: buf.toString('base64') }
    const { image_id } = await this.ctx.http.post<{ image_id: string }>(`${this.url}/image/upload`, payload)
    return image_id
  }
}
