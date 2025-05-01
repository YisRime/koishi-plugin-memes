import { Context, h, Logger } from 'koishi'
import { parseTarget, getUserAvatar, autoRecall, apiRequest, readJsonFile, writeJsonFile } from './utils'
import path from 'path'

/**
 * 表情包模板信息接口
 * @interface MemeInfo
 */
export interface MemeInfo {
  id: string
  keywords: string[]
  tags: string[]
  params_type?: {
    min_images?: number
    max_images?: number
    min_texts?: number
    max_texts?: number
    default_texts?: string[]
    [key: string]: any
  }
  [key: string]: any
}

/**
 * 图片获取信息类型
 * @typedef {Object} ImageFetchInfo
 */
export type ImageFetchInfo =
  { src: string } |
  { userId: string }

/**
 * 解析后的参数接口
 * @interface ResolvedArgs
 */
export interface ResolvedArgs {
  imageInfos: ImageFetchInfo[]
  texts: string[]
  options: Record<string, any>
}

/**
 * 表情包生成器类
 * 负责管理模板、解析参数和生成表情包
 * @class MemeGenerator
 */
export class MemeGenerator {
  private memeCache: MemeInfo[] = []
  private cachePath: string

  /**
   * 创建表情包生成器实例
   * @param {Context} ctx - Koishi 上下文
   * @param {Logger} logger - 日志记录器
   * @param {string} apiUrl - API服务器地址
   */
  constructor(
    private ctx: Context,
    private logger: Logger,
    private apiUrl: string = ''
  ) {
    this.apiUrl = apiUrl?.trim().replace(/\/+$/, '')
    this.cachePath = path.resolve(this.ctx.baseDir, 'data', 'memes.json')
    // 加载缓存
    const cacheData = readJsonFile<{time: number, data: MemeInfo[]}>(this.cachePath, this.logger)
    this.memeCache = cacheData?.data || []
    this.memeCache.length ? this.logger.info(`已加载缓存文件（${this.memeCache.length}项）`) : this.refreshCache()
  }

  /**
   * 刷新模板缓存
   * 从API获取最新的模板列表和信息，并更新本地缓存
   * @returns {Promise<MemeInfo[]>} 更新后的模板列表
   */
  async refreshCache(): Promise<MemeInfo[]> {
    try {
      const keys = await apiRequest<string[]>(`${this.apiUrl}/memes/keys`, {}, this.logger)
      if (!keys?.length) {
        this.logger.warn('获取模板列表失败或为空')
        return []
      }
      this.logger.info(`已获取模板ID: ${keys.length}个`)
      const templates = await Promise.all(keys.map(async key => {
        try {
          const info = await apiRequest<any>(`${this.apiUrl}/memes/${key}/info`, {}, this.logger)
          return {
            id: key,
            keywords: info?.keywords ?
              (Array.isArray(info.keywords) ? info.keywords : [info.keywords]).filter(Boolean) : [],
            tags: info?.tags && Array.isArray(info.tags) ? info.tags : [],
            params_type: info?.params_type || {},
            ...(info || {})
          }
        } catch (e) {
          this.logger.warn(`获取模板[${key}]信息失败：${e.message}`)
          return { id: key, keywords: [], tags: [], params_type: {} }
        }
      }))
      writeJsonFile(this.cachePath, { time: Date.now(), data: templates }, this.logger)
      this.memeCache = templates
      return templates
    } catch (e) {
      this.logger.error(`刷新缓存失败: ${e.message}`)
      return []
    }
  }

  /**
   * 匹配模板关键词
   * 根据提供的关键词查找匹配的模板，并按优先级排序
   * @param {string} key - 要匹配的关键词
   * @returns {MemeInfo[]} 匹配到的模板列表，按匹配优先级排序
   */
  matchTemplates(key: string): MemeInfo[] {
    if (!key || !this.memeCache.length) return []
    // 按优先级排序匹配
    return this.memeCache
      .map(template => {
        let priority = 99
        if (template.id === key || template.keywords?.some(k => k === key)) priority = 1
        else if (template.keywords?.some(k => k.includes(key))) priority = 2
        else if (template.keywords?.some(k => key.includes(k))) priority = 3
        else if (template.id.includes(key)) priority = 4
        else if (template.tags?.some(tag => tag === key || tag.includes(key))) priority = 5
        return { template, priority }
      })
      .filter(item => item.priority < 99)
      .sort((a, b) => a.priority - b.priority)
      .map(item => item.template)
  }

  /**
   * 查找表情包模板
   * 先从缓存中查找，如果找不到则尝试从API获取
   * @param {string} key - 要查找的模板ID或关键词
   * @param {boolean} fuzzy - 是否启用模糊匹配，默认为true
   * @returns {Promise<MemeInfo | null>} 找到的模板信息，如果未找到则返回null
   */
  async findTemplate(key: string, fuzzy: boolean = true): Promise<MemeInfo | null> {
    // 从缓存查找
    const matchedTemplates = fuzzy ?
      this.matchTemplates(key) :
      this.memeCache.filter(t => t.id === key || t.keywords?.some(k => k === key))
    if (matchedTemplates.length > 0) return matchedTemplates[0]
    // 从API获取
    if (this.apiUrl) {
      try {
        const info = await apiRequest<any>(`${this.apiUrl}/memes/${key}/info`, {}, this.logger)
        if (info) {
          return {
            id: key,
            keywords: info.keywords ?
              (Array.isArray(info.keywords) ? info.keywords : [info.keywords]).filter(Boolean) : [],
            tags: info.tags && Array.isArray(info.tags) ? info.tags : [],
            params_type: info.params_type || {},
            ...(info || {})
          }
        }
      } catch (e) {
        this.logger.warn(`从API获取模板[${key}]信息失败：${e.message}`)
      }
    }
    return null
  }

  /**
   * 获取所有关键词到模板ID的映射
   * 用于快速查找和自动补全功能
   * @returns {Map<string, string>} 关键词到模板ID的映射表
   */
  getAllKeywordMappings(): Map<string, string> {
    const keywordMap = new Map<string, string>()
    this.memeCache.forEach(template => {
      keywordMap.set(template.id, template.id)
      if (Array.isArray(template.keywords)) {
        template.keywords.forEach(keyword => keyword && keywordMap.set(keyword, template.id))
      }
    })
    return keywordMap
  }

  /**
   * 生成表情包
   * 解析指令参数，获取所需的图片和文本，然后调用API生成表情包
   * @param {any} session - 消息会话对象
   * @param {string} key - 模板ID或关键词
   * @param {h[]} args - 参数元素列表
   * @returns {Promise<h | string>} 生成的表情包图片元素或错误消息
   */
  async generateMeme(session: any, key: string, args: h[]) {
    try {
      const templateInfo = await this.findTemplate(key)
      if (!templateInfo) return autoRecall(session, `获取模板信息失败: ${key}`)
      const tempId = templateInfo.id || key
      const {
        min_images = 0, max_images = 0,
        min_texts = 0, max_texts = 0,
        default_texts = []
      } = templateInfo.params_type || {}
      // 解析参数
      const imageInfos: ImageFetchInfo[] = []
      const texts: string[] = []
      const options: Record<string, any> = {}
      let allText = ''
      // 处理引用消息中的图片
      if (session.quote?.elements) {
        const processElement = (e) => {
          if (e.type === 'img' && e.attrs.src) imageInfos.push({ src: e.attrs.src })
          if (e.children?.length) e.children.forEach(processElement)
        }
        session.quote.elements.forEach(processElement)
      }
      // 处理文本内容和元素
      const processElement = (e: h): void => {
        if (e.type === 'text' && e.attrs.content) {
          let text = e.attrs.content
            .replace(/<at id=['"]?([0-9]+)['"]?\/>/g, (_, userId) => {
              userId && imageInfos.push({ userId })
              return ' '
            })
            .replace(/<img[^>]*src=['"]([^'"]+)['"][^>]*\/?>/g, (_, src) => {
              src && imageInfos.push({ src })
              return ' '
            })
          allText += text + ' '
        }
        else if (e.type === 'at' && e.attrs.id) imageInfos.push({ userId: e.attrs.id })
        else if (e.type === 'img' && e.attrs.src) imageInfos.push({ src: e.attrs.src })
        e.children?.length && e.children.forEach(processElement)
      }
      args.forEach(processElement)
      // 解析文本参数
      if (allText.trim()) {
        const tokens = allText.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
        tokens.forEach(token => {
          if (token.startsWith('-')) {
            // 选项参数
            const optMatch = token.match(/^-([a-zA-Z0-9_-]+)(?:=(.*))?$/)
            if (optMatch) {
              const [, key, rawValue = 'true'] = optMatch
              // 自动转换值类型
              let value: any = rawValue
              if (rawValue === 'true') value = true
              else if (rawValue === 'false') value = false
              else if (/^-?\d+$/.test(rawValue)) value = parseInt(rawValue, 10)
              else if (/^-?\d+\.\d+$/.test(rawValue)) value = parseFloat(rawValue)
              options[key] = value
            }
          }
          else if (token.startsWith('<at') || token.startsWith('@')) {
            // at文本
            const userId = token.startsWith('<at') ? parseTarget(token) : token.match(/@(\d+)/)?.[1]
            userId ? imageInfos.push({ userId }) : token.startsWith('@') && texts.push(token)
          }
          else {
            // 普通文本
            texts.push(token.replace(/^(['"])(.*)\1$/, '$2'))
          }
        })
      }
      // 转换选项类型
      const properties = templateInfo?.params_type?.args_type?.args_model?.properties || {}
      Object.entries(properties).forEach(([key, prop]) => {
        const typedProp = prop as { type?: string }
        if (key in options && key !== 'user_infos') {
          const value = options[key]
          if (typedProp.type === 'integer' && typeof value !== 'number')
            options[key] = parseInt(String(value), 10)
          else if (typedProp.type === 'number' && typeof value !== 'number')
            options[key] = parseFloat(String(value))
          else if (typedProp.type === 'boolean' && typeof value !== 'boolean')
            options[key] = value === 'true' || value === '1' || value === 1
        }
      })
      // 补充自身头像和默认文本
      let origImageInfos = [...imageInfos]
      let origTexts = [...texts]
      const needSelfAvatar = (min_images === 1 && !origImageInfos.length) ||
                            (origImageInfos.length && origImageInfos.length + 1 === min_images)
      if (needSelfAvatar) origImageInfos = [{ userId: session.userId }, ...origImageInfos]
      if (!origTexts.length && default_texts.length) origTexts = [...default_texts]
      // 验证参数数量
      const checkCount = (count, min, max, type) => {
        if ((min != null && count < min) || (max != null && count > max)) {
          const rangeText = min === max ? min :
                          min != null && max != null ? `${min}~${max}` :
                          min != null ? `至少${min}` : `最多${max}`
          throw new Error(`当前${count}${type === '图片' ? '张' : '条'}${type}，需要${rangeText}${type === '图片' ? '张' : '条'}${type}`)
        }
      }
      checkCount(origImageInfos.length, min_images, max_images, '图片')
      checkCount(origTexts.length, min_texts, max_texts, '文本')
      // 获取图片和用户信息
      const images = []
      const userInfos = []
      await Promise.all(origImageInfos.map(async (info, index) => {
        try {
          // 获取URL和用户信息
          const url = 'src' in info ? info.src : await getUserAvatar(session, info.userId)
          const userInfo = 'userId' in info ? { name: info.userId } : {}
          // 获取图片内容
          const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
          if (!response.ok) throw new Error(`HTTP状态码 ${response.status}`)
          const contentType = response.headers.get('content-type') || 'image/png'
          const buffer = Buffer.from(await response.arrayBuffer())
          images[index] = new Blob([buffer], { type: contentType })
          userInfos[index] = userInfo
        } catch {
          // 创建空白占位符
          images[index] = new Blob([], { type: 'image/png' })
          userInfos[index] = 'userId' in info ? { name: info.userId } : {}
        }
      }))
      // 渲染表情包
      const formData = new FormData()
      // 添加参数
      origTexts.forEach(text => formData.append('texts', text))
      images.forEach(img => formData.append('images', img))
      formData.append('args', JSON.stringify({
        user_infos: userInfos,
        ...options
      }))
      // 发送请求
      const imageBuffer = await apiRequest<Buffer>(
        `${this.apiUrl}/memes/${tempId}/`,
        { method: 'post', formData, responseType: 'arraybuffer', timeout: 10000 },
        this.logger
      )
      if (!imageBuffer) return autoRecall(session, '生成表情包失败：未获取到 API 数据')
      return h('image', { url: `data:image/png;base64,${Buffer.from(imageBuffer).toString('base64')}` })
    } catch (e) {
      return autoRecall(session, e.message)
    }
  }
}