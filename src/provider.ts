import { Context, h, Session, Logger } from 'koishi'
import { Config } from './index'

/**
 * @interface ParserFlags
 * @description 定义了命令行参数的解析标志。
 */
export interface ParserFlags {
  short?: boolean
  long?: boolean
  short_aliases?: string[]
  long_aliases?: string[]
}

/**
 * @interface MemeOption
 * @description 定义了表情模板的额外可配置选项。
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
 * @interface MemeShortcut
 * @description 定义了表情模板的快捷指令。
 */
export interface MemeShortcut {
  pattern: string
  humanized?: string | null
}

/**
 * @interface MemeInfo
 * @description 定义了单个表情模板的完整结构。
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
 * 从用户会话中获取头像 URL。
 * 如果无法通过 bot API 获取，则回退到 QQ 的公开头像链接。
 * @param session - 当前 Koishi 会话对象。
 * @param userId - (可选) 目标用户 ID，默认为会话发起者。
 * @returns 返回一个包含头像 URL 的 Promise。
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
 * @class MemeProvider
 * @description 负责与后端 API 交互，管理表情模板的获取、生成和处理。
 *              支持两种缓存策略：全量缓存和仅缓存 key。
 */
export class MemeProvider {
  public isRsApi: boolean = false
  private cache: MemeInfo[] = []
  private keys: string[] = []
  private logger: Logger

  /**
   * MemeProvider 构造函数。
   * @param ctx - Koishi 的上下文对象。
   * @param url - 后端 API 的地址。
   * @param config - 插件的配置项。
   */
  constructor(private ctx: Context, public url: string, private config: Config) {
    this.logger = ctx.logger('memes')
  }

  /**
   * 启动并初始化 Provider。
   * 它会检查 API 版本并根据配置拉取数据。
   * @returns 返回一个包含版本号和模板总数的对象。
   */
  async start(): Promise<{ version: string; count: number }> {
    const versionRaw = await this.ctx.http.get<string>(`${this.url}/meme/version`, { responseType: 'text' })
    const version = versionRaw.replace(/"/g, '')
    this.isRsApi = !version.startsWith('0.1.')
    const count = await this.fetch()
    return { version, count }
  }

  /**
   * 根据配置从后端 API 拉取数据。
   * 如果 `cacheAllInfo` 为 true，则缓存所有模板的详细信息；
   * 否则，仅缓存模板的 key 列表。
   * @returns 返回获取到的模板总数。
   */
  async fetch(): Promise<number> {
    if (this.config.cacheAllInfo) {
      if (this.isRsApi) {
        const data = await this.ctx.http.get<any[]>(`${this.url}/meme/infos`)
        this.cache = data.map((info) => ({
          key: info.key,
          keywords: info.keywords || [],
          minImages: info.params.min_images,
          maxImages: info.params.max_images,
          minTexts: info.params.min_texts,
          maxTexts: info.params.max_texts,
          defaultTexts: info.params.default_texts || [],
          args: (info.params.options || []).map((opt) => ({ ...opt })),
          tags: info.tags || [],
          shortcuts: info.shortcuts || [],
          date_created: info.date_created,
          date_modified: info.date_modified,
        }))
      } else {
        const keys = await this.ctx.http.get<string[]>(`${this.url}/memes/keys`)
        const results = await Promise.allSettled(keys.map((key) => this.ctx.http.get<any>(`${this.url}/memes/${key}/info`, { timeout: 30000 })))
        this.cache = results.filter((res): res is PromiseFulfilledResult<any> => res.status === 'fulfilled' && res.value)
          .map((res) => {
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
                  choices: prop.enum || null,
                })),
              tags: data.tags || [],
              shortcuts: data.shortcuts || [],
              date_created: data.date_created,
              date_modified: data.date_modified,
            }
          })
      }
      this.keys = this.cache.map((item) => item.key)
      return this.cache.length
    } else {
      const endpoint = this.isRsApi
        ? `${this.url}/meme/keys`
        : `${this.url}/memes/keys`
      this.keys = await this.ctx.http.get<string[]>(endpoint)
      return this.keys.length
    }
  }

  /**
   * @description 根据会话的上下文（群组ID）和全局配置，计算并返回一个包含所有被禁用表情 key 的集合。
   * @param {string} [guildId] - (可选) 当前会话的群组 ID。如果提供，将用于匹配特定群组的禁用规则。
   * @returns {Set<string>} 一个包含所有在当前上下文中被禁用的表情 key 的集合，可用于快速过滤。
   */
  private getExclusionSet(guildId?: string): Set<string> {
    const allBannedKeys: string[] = []
    if (!this.config.blacklist || !this.config.blacklist.length) return new Set()

    for (const rule of this.config.blacklist) {
      if (!rule.guildId || rule.guildId === guildId) {
        if (rule.keyId && typeof rule.keyId === 'string') {
          const keys = rule.keyId.split(',').map(key => key.trim()).filter(Boolean)
          allBannedKeys.push(...keys)
        }
      }
    }
    return new Set(allBannedKeys)
  }

  /**
   * 快速判断一个词是否可以触发表情制作。
   * 此方法仅操作本地缓存，不产生网络请求。
   * @param word - 要检查的单词 (key 或 keyword)。
   * @returns 如果可以触发则返回 true。
   */
  isTriggerable(word: string): boolean {
    if (this.config.cacheAllInfo) return this.cache.some((t) => t.key === word || t.keywords.includes(word))
    return this.keys.includes(word)
  }

  /**
   * 根据关键词查找对应的快捷指令。
   * 仅在 `cacheAllInfo` 模式下有效。
   * @param word - 要查找的快捷指令关键词。
   * @param session - 当前 Koishi 会话，用于检查黑名单。
   * @returns 如果找到，则返回包含模板信息和快捷指令参数的对象，否则返回 null。
   */
  public findShortcut(word: string, session?: Session): { meme: MemeInfo, shortcutArgs: string[] } | null {
    if (!this.config.cacheAllInfo) return null
    const exclusionSet = this.getExclusionSet(session?.guildId)

    for (const meme of this.cache) {
      if (exclusionSet.has(meme.key)) continue
      if (!meme.shortcuts) continue
      for (const sc of meme.shortcuts) {
        const shortcutKey = sc.pattern || (sc as any).key
        if (shortcutKey === word) {
          const shortcutArgs: string[] = []
          const options = (sc as any).options
          if (options && typeof options === 'object') {
            for (const [key, value] of Object.entries(options)) {
              if (typeof value === 'boolean' && value === true) {
                shortcutArgs.push(`--${key}`)
              } else {
                const formattedValue = String(value).includes(' ') ? `"${value}"` : value
                shortcutArgs.push(`--${key}=${formattedValue}`)
              }
            }
          }
          const args = (sc as any).args
          if (Array.isArray(args)) shortcutArgs.push(...args)
          return { meme, shortcutArgs }
        }
      }
    }
    return null
  }

  /**
   * 根据 key 或关键词获取单个模板信息。
   * - 缓存模式下：从内存中直接查找。
   * - 非缓存模式下：通过网络请求获取。
   * @param keyOrKeyword - 模板的 key 或关键词。
   * @param session - 当前 Koishi 会话，用于检查黑名单。
   * @returns 返回找到的 MemeInfo 对象，如果找不到或被禁用则返回 null。
   */
  async getInfo(keyOrKeyword: string, session?: Session): Promise<MemeInfo | null> {
    const exclusionSet = this.getExclusionSet(session?.guildId)
    const findInCache = () => this.cache.find((t) => t.key === keyOrKeyword || t.keywords.includes(keyOrKeyword)) || null

    let item: MemeInfo | null
    if (this.config.cacheAllInfo) {
      item = findInCache()
    } else {
      let key = keyOrKeyword
      if (!this.keys.includes(key)) {
        if (this.isRsApi) {
          const results = await this.search(key, session) as string[]
          key = results[0]
          if (!key) return null
        } else {
          const found = findInCache()
          if (!found) return null
          key = found.key
        }
      }
      if (exclusionSet.has(key)) return null

      try {
        if (this.isRsApi) {
          const info = await this.ctx.http.get<any>(`${this.url}/memes/${key}/info`)
          item = {
            key: info.key,
            keywords: info.keywords || [],
            minImages: info.params.min_images,
            maxImages: info.params.max_images,
            minTexts: info.params.min_texts,
            maxTexts: info.params.max_texts,
            defaultTexts: info.params.default_texts || [],
            args: (info.params.options || []).map((opt) => ({ ...opt })),
            tags: info.tags || [],
            shortcuts: info.shortcuts || [],
            date_created: info.date_created,
            date_modified: info.date_modified,
          }
        } else {
          const data = await this.ctx.http.get<any>(`${this.url}/memes/${key}/info`)
          const params = data.params_type
          item = {
            key: data.key,
            keywords: data.keywords || [],
            minImages: params.min_images,
            maxImages: params.max_images,
            minTexts: params.min_texts,
            maxTexts: params.max_texts,
            defaultTexts: params.default_texts || [],
            args: Object.entries(params.args_type?.args_model?.properties || {}).filter(([k]) => k !== 'user_infos')
              .map(([k, prop]: [string, any]) => ({
                name: k,
                type: prop.type,
                default: prop.default,
                description: prop.description,
                choices: prop.enum || null,
              })),
            tags: data.tags || [],
            shortcuts: data.shortcuts || [],
            date_created: data.date_created,
            date_modified: data.date_modified,
          }
        }
      } catch (e) {
        this.logger.warn(`获取模板 "${key}" 信息失败:`, e)
        return null
      }
    }

    if (!item || exclusionSet.has(item.key)) return null
    return item
  }

  /**
   * 根据查询字符串搜索模板。
   * - 缓存模式下：在本地进行带权重的模糊搜索。
   * - 非缓存模式下：依赖服务端的搜索接口或进行简单的 key 匹配。
   * @param query - 搜索关键词。
   * @param session - 当前 Koishi 会话，用于过滤黑名单。
   * @returns 返回匹配的 key 数组或 MemeInfo 数组。
   */
  async search(query: string, session?: Session): Promise<string[] | MemeInfo[]> {
    const exclusionSet = this.getExclusionSet(session?.guildId)

    if (this.config.cacheAllInfo) {
      const results = this.cache
        .map((item) => {
          let priority = 0
          if (item.key === query || item.keywords.includes(query)) priority = 5
          else if (item.keywords.some((k) => k.includes(query))) priority = 4
          else if (item.key.includes(query)) priority = 3
          else if (item.tags?.some((t) => t.includes(query))) priority = 2
          return { item, priority }
        }).filter((p) => p.priority > 0).sort((a, b) => b.priority - a.priority).map((p) => p.item)
      return results.filter(item => !exclusionSet.has(item.key))
    }

    let results: string[]
    if (this.isRsApi) {
      results = await this.ctx.http.get<string[]>(`${this.url}/meme/search`, { params: { query, include_tags: true } })
    } else {
      results = this.keys.filter((key) => key.includes(query))
    }
    return results.filter(key => !exclusionSet.has(key))
  }

  /**
   * 随机获取一个模板信息。
   * - 缓存模式下：从内存中随机选择。
   * - 非缓存模式下：随机选择一个 key 再通过网络请求获取。
   * @param session - 当前 Koishi 会话，用于过滤黑名单。
   * @returns 返回找到的 MemeInfo 对象，如果找不到则返回 null。
   */
  async getRandom(session?: Session): Promise<MemeInfo | null> {
    const exclusionSet = this.getExclusionSet(session?.guildId)

    if (this.config.cacheAllInfo) {
      if (!this.cache.length) return null
      const available = this.cache.filter(item => !exclusionSet.has(item.key))
      if (!available.length) return null
      const randomIndex = Math.floor(Math.random() * available.length)
      return available[randomIndex]
    }

    if (!this.keys.length) return null
    const available = this.keys.filter(key => !exclusionSet.has(key))
    if (!available.length) return null
    const randomKey = available[Math.floor(Math.random() * available.length)]
    return this.getInfo(randomKey, session)
  }

  /**
   * 获取指定模板的预览图。
   * @param key - 模板的 key。
   * @returns 返回包含图片 Buffer 的 Promise，或在失败时返回错误信息的字符串。
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
      this.logger.warn(`预览图 "${key}" 获取失败:`, e)
      return `[预览图获取失败: ${e.message}]`
    }
  }

  /**
   * 根据输入创建表情图片。
   * @param key - 模板的 key。
   * @param input - Koishi 的 h 元素数组，包含图片和文本。
   * @param session - 当前 Koishi 会话对象。
   * @returns 返回一个包含生成图片的 h 元素，或在失败时返回错误信息的字符串。
   * @throws {Error} 当参数不足时，抛出名为 'MissError' 的错误。
   */
  async create(key: string, input: h[], session: Session,): Promise<h | string> {
    const item = await this.getInfo(key, session)
    if (!item) return `模板 "${key}" 不存在`

    let imgs: string[] = []
    let texts: string[] = []
    const args: Record<string, any> = {}

    for (const el of input) {
      if (el.type === 'img' && el.attrs.src) imgs.push(el.attrs.src)
      else if (el.type === 'at' && el.attrs.id)
        imgs.push(await getAvatar(session, el.attrs.id))
      else if (el.type === 'text' && el.attrs.content) {
        el.attrs.content
          .trim()
          .split(/\s+/)
          .forEach((token) => {
            if (!token) return
            const match = token.match(/^--([^=]+)(?:=(.*))?$/)
            if (match) {
              const key = match[1]
              const value = match[2]
              args[key] = value !== undefined ? value : true
            } else {
              texts.push(token)
            }
          })
      }
    }

    if (this.config.useUserAvatar && (item.minImages - imgs.length === 1)) imgs.unshift(await getAvatar(session))

    if (this.config.fillDefaultText !== 'disable' && item.defaultTexts?.length > 0) {
      if (this.config.fillDefaultText === 'missing' && texts.length === 0) {
        texts = [...item.defaultTexts];
      } else if (this.config.fillDefaultText === 'insufficient' && texts.length < item.minTexts) {
        const needed = item.minTexts - texts.length;
        const availableDefaults = item.defaultTexts.slice(texts.length);
        texts.push(...availableDefaults.slice(0, needed));
      }
    }

    if (imgs.length > item.maxImages) {
      if (this.config.ignoreExcess) {
        imgs.splice(item.maxImages)
      } else {
        return `当前共有 ${imgs.length}/${item.maxImages} 张图片，请删除多余参数`
      }
    }
    if (texts.length > item.maxTexts) {
      if (this.config.ignoreExcess) {
        texts.splice(item.maxTexts)
      } else {
        return `当前共有 ${texts.length}/${item.maxTexts} 条文本，请删除多余参数`
      }
    }

    if (imgs.length < item.minImages) {
      const err = new Error(`当前共有 ${imgs.length}/${item.minImages} 张图片`);
      err.name = 'MissError';
      throw err;
    }
    if (texts.length < item.minTexts) {
      const err = new Error(`当前共有 ${texts.length}/${item.minTexts} 条文本`);
      err.name = 'MissError';
      throw err;
    }

    try {
      if (this.isRsApi) {
        const imgBuffers = await Promise.all(imgs.map((url) => this.ctx.http.get<ArrayBuffer>(url, { responseType: 'arraybuffer' })),)
        const imgIds = await Promise.all(imgBuffers.map((buf) => this.upload(Buffer.from(buf))))
        const payload = { images: imgIds.map((id) => ({ id })), texts, options: args }
        const res = await this.ctx.http.post<{ image_id: string }>(`${this.url}/memes/${key}`, payload, { timeout: 30000 })
        const finalImg = await this.ctx.http.get<ArrayBuffer>(`${this.url}/image/${res.image_id}`, { responseType: 'arraybuffer' })
        return h.image(Buffer.from(finalImg), 'image/gif')
      } else {
        const form = new FormData()
        texts.forEach((t) => form.append('texts', t))
        await Promise.all(
          imgs.map(async (url, index) => {
            const resp = await this.ctx.http.get<ArrayBuffer>(url, { responseType: 'arraybuffer' })
            const filename = this.getFilenameFromUrl(url, `${index}.png`);
            form.append('images', new File([resp], filename, { type: 'image/png' }));
          }),
        )
        if (Object.keys(args).length) form.append('args', JSON.stringify(args))
        const result = await this.ctx.http.post<ArrayBuffer>(`${this.url}/memes/${key}/`, form, { responseType: 'arraybuffer', timeout: 30000 })
        return h.image(Buffer.from(result), 'image/gif')
      }
    } catch (e) {
      this.logger.warn(`图片生成失败 (${item.key}):`, e)
      return `图片生成失败: ${e.message}`
    }
  }

  /**
   * 调用后端 API 渲染模板列表图片。
   * @param session - 当前 Koishi 会话，用于过滤黑名单。
   * @returns 返回包含图片的 Buffer 或错误信息字符串。
   */
  async renderList(session?: Session): Promise<Buffer | string> {
    try {
      if (this.isRsApi) {
        const payload: any = {}
        const meme_properties: Record<string, { new?: boolean, disabled?: boolean }> = {}

        if (this.config.sortListBy) {
          const [sortBy, sortDir] = this.config.sortListBy.split(/_(asc|desc)$/)
          payload.sort_by = sortBy
          payload.sort_reverse = sortDir === 'desc'
        }

        if (this.config.listTextTemplate) payload.text_template = this.config.listTextTemplate
        if (this.config.showListIcon !== undefined && this.config.showListIcon !== null) payload.add_category_icon = this.config.showListIcon

        if (this.config.cacheAllInfo && this.config.markAsNewDays > 0) {
          const now = new Date()
          const threshold = now.setDate(now.getDate() - this.config.markAsNewDays)
          for (const meme of this.cache) {
            const memeDate = Date.parse(meme.date_modified || meme.date_created)
            if (memeDate > threshold) meme_properties[meme.key] = { ...meme_properties[meme.key], new: true }
          }
        }

        const exclusionSet = this.getExclusionSet(session?.guildId)
        for (const key of exclusionSet) meme_properties[key] = { ...meme_properties[key], disabled: true }
        if (Object.keys(meme_properties).length > 0) payload.meme_properties = meme_properties

        const res = await this.ctx.http.post<{ image_id: string }>(`${this.url}/tools/render_list`, payload)
        const buf = await this.ctx.http.get(`${this.url}/image/${res.image_id}`, { responseType: 'arraybuffer' })
        return Buffer.from(buf)
      } else {
        const exclusionSet = this.getExclusionSet(session?.guildId)
        const availableKeys = this.keys.filter(key => !exclusionSet.has(key));
        const payload: any = { meme_list: availableKeys.map((key) => ({ meme_key: key })) }
        if (this.config.listTextTemplate) payload.text_template = this.config.listTextTemplate
        if (this.config.showListIcon !== undefined && this.config.showListIcon !== null) payload.add_category_icon = this.config.showListIcon

        const buf = await this.ctx.http.post<ArrayBuffer>(`${this.url}/memes/render_list`, payload, { responseType: 'arraybuffer' })
        return Buffer.from(buf)
      }
    } catch (e) {
      this.logger.warn('列表渲染失败:', e)
      return `列表渲染失败: ${e.message}`
    }
  }

  /**
   * 调用后端 API 渲染统计图片。
   * @param title - 统计图标题。
   * @param type - 统计类型 ('meme_count' 或 'time_count')。
   * @param data - 统计数据，格式为 `[key, value]` 对的数组。
   * @returns 返回包含图片的 Buffer 或错误信息字符串。
   */
  async renderStatistics(title: string, type: string, data: [string, number][],): Promise<Buffer | string> {
    try {
      const payload = { title, statistics_type: type, data }
      const res = await this.ctx.http.post<{ image_id: string }>(`${this.url}/tools/render_statistics`, payload)
      const buf = await this.ctx.http.get<Buffer>(`${this.url}/image/${res.image_id}`, { responseType: 'arraybuffer' })
      return Buffer.from(buf)
    } catch (e) {
      this.logger.warn('统计图渲染失败:', e)
      return `统计图渲染失败: ${e.message}`
    }
  }

  /**
   * 调用后端 API 对单张图片进行处理。
   * @param endpoint - API 的端点名称。
   * @param imageUrl - 要处理的图片的 URL。
   * @param payload - (可选) 附加的请求体数据。
   * @returns 返回处理结果，可能是包含图片的 h 元素或文本信息。
   */
  async processImage(endpoint: string, imageUrl: string, payload: any = {}): Promise<h | string> {
    try {
      const buf = await this.ctx.http.get<ArrayBuffer>(imageUrl, { responseType: 'arraybuffer' })
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
      const finalBuf = await this.ctx.http.get<ArrayBuffer>(`${this.url}/image/${res.image_id}`, { responseType: 'arraybuffer' })
      return h.image(Buffer.from(finalBuf), 'image/png')
    } catch (e) {
      this.logger.warn(`图片 "${endpoint}" 处理失败:`, e)
      return `图片处理失败: ${e.message}`
    }
  }

  /**
   * 调用后端 API 对多张图片进行处理。
   * @param endpoint - API 的端点名称。
   * @param sources - 包含多个图片 URL 的数组。
   * @param payload - (可选) 附加的请求体数据。
   * @returns 返回处理后的图片 h 元素，或错误信息。
   */
  async processImages(endpoint: string, sources: string[], payload: any = {}): Promise<h | string> {
    try {
      const image_ids = await Promise.all(sources.map((url) => this.ctx.http.get<ArrayBuffer>(url, { responseType: 'arraybuffer' }).then((buf) => this.upload(Buffer.from(buf)))))
      const finalBuf = await this.performMerge(image_ids, endpoint, payload)
      return h.image(finalBuf, 'image/png')
    } catch (e) {
      this.logger.warn(`图片 "${endpoint}" 处理失败:`, e)
      return `图片处理失败: ${e.message}`
    }
  }

  /**
   * 封装图片合并端点的请求逻辑。
   * @param image_ids - 已上传的图片 ID 列表。
   * @param endpoint - API 的端点名称。
   * @param payload - 附加的请求体数据。
   * @returns 返回包含合并后图片的 Buffer。
   */
  private async performMerge(image_ids: string[], endpoint: string, payload: any): Promise<Buffer> {
    const finalPayload = { ...payload, image_ids }
    const res = await this.ctx.http.post<{ image_id: string }>(`${this.url}/tools/image_operations/${endpoint}`, finalPayload)
    const finalBuf = await this.ctx.http.get<ArrayBuffer>(`${this.url}/image/${res.image_id}`, { responseType: 'arraybuffer' })
    return Buffer.from(finalBuf)
  }

  /**
   * 从 URL 中智能提取或生成文件名。
   * @param url - 图片的 URL。
   * @param fallbackName - 当无法从 URL 中提取文件名时的备用名称。
   * @returns 返回一个合理的文件名。
   */
  private getFilenameFromUrl(url: string, fallbackName: string): string {
    try {
      const parsedUrl = new URL(url)
      const pathSegments = parsedUrl.pathname.split('/')
      const lastSegment = pathSegments[pathSegments.length - 1]
      if (lastSegment && lastSegment.includes('.')) return decodeURIComponent(lastSegment)
    } catch (e) {}
    return fallbackName
  }

  /**
   * 将图片 Buffer 上传到后端 API。
   * @param buf - 包含图片数据的 Buffer。
   * @returns 返回上传后得到的 image_id。
   */
  private async upload(buf: Buffer): Promise<string> {
    const payload = { type: 'data', data: buf.toString('base64') }
    const { image_id } = await this.ctx.http.post<{ image_id: string }>(`${this.url}/image/upload`, payload)
    return image_id
  }
}
