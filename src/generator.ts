import { Context, h, Logger } from 'koishi'
import { parseTarget, getUserAvatar, autoRecall } from './index'
import axios from 'axios'
import fs from 'fs'
import path from 'path'

/**
 * 表情包模板信息接口
 * @interface MemeInfo
 * @description 描述表情包模板的结构信息
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
 * 图片获取信息
 * @typedef {Object} ImageFetchInfo
 * @description 表示获取图片的来源信息，可以是URL或用户ID
 */
export type ImageFetchInfo = { src: string } | { userId: string }

/**
 * 解析后的参数
 * @interface ResolvedArgs
 * @description 解析命令后得到的参数结构
 */
export interface ResolvedArgs {
  imageInfos: ImageFetchInfo[]
  texts: string[]
  options: Record<string, any>
}

/**
 * 图片和用户信息
 * @interface ImagesAndInfos
 * @description 包含已获取的图片和对应的用户信息
 */
export interface ImagesAndInfos {
  images: Blob[]
  userInfos: any[]
}

/**
 * 表情包生成器类
 * @class MemeGenerator
 * @description 负责与表情包API交互并生成表情包
 */
export class MemeGenerator {
  private memeCache: MemeInfo[] = []
  private cachePath: string

  /**
   * 创建表情包生成器实例
   * @param {Context} ctx - Koishi上下文
   * @param {Logger} logger - 日志记录器
   * @param {string} apiUrl - API服务地址
   */
  constructor(
    private ctx: Context,
    private logger: Logger,
    private apiUrl: string = ''
  ) {
    this.apiUrl = apiUrl?.trim().replace(/\/+$/, '')
    this.cachePath = path.resolve(this.ctx.baseDir, 'data', 'memes.json')
    this.initCache()
  }

  /**
   * 初始化模板缓存
   * @private
   * @async
   */
  private async initCache() {
    if (!this.apiUrl) return
    this.memeCache = await this.loadCache()
    if (!this.memeCache.length) await this.refreshCache()
    else this.logger.info(`已加载缓存文件：${this.memeCache.length}项`)
  }

  /**
   * 从本地文件加载缓存
   * @private
   * @async
   * @returns {Promise<MemeInfo[]>} 模板信息数组
   */
  private async loadCache(): Promise<MemeInfo[]> {
    try {
      if (fs.existsSync(this.cachePath)) {
        const cacheData = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'))
        if (cacheData.time && cacheData.data) return cacheData.data
      }
    } catch (e) {
      this.logger.warn(`读取缓存失败: ${e.message}`)
    }
    return []
  }

  /**
   * 保存缓存到本地文件
   * @private
   * @async
   * @param {MemeInfo[]} data - 要保存的模板数据
   * @returns {Promise<void>}
   */
  private async saveCache(data: MemeInfo[]): Promise<void> {
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify({ time: Date.now(), data }, null, 2), 'utf-8')
      this.logger.info(`已创建缓存文件：${data.length}项`)
    } catch (e) {
      this.logger.error(`保存缓存失败: ${e.message}`)
    }
  }

  /**
   * 刷新模板缓存
   * @async
   * @returns {Promise<MemeInfo[]>} 刷新后的模板信息数组
   */
  async refreshCache(): Promise<MemeInfo[]> {
    try {
      const keys = await this.apiRequest<string[]>(`${this.apiUrl}/memes/keys`)
      if (!keys?.length) {
        this.logger.warn(`获取模板列表失败或为空`)
        return []
      }
      this.logger.info(`已获取模板ID: ${keys.length}个`)
      const templates = await Promise.all(keys.map(async key => {
        try {
          const info = await this.apiRequest<any>(`${this.apiUrl}/memes/${key}/info`)
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
      await this.saveCache(templates)
      this.memeCache = templates
      return templates
    } catch (e) {
      this.logger.error(`刷新缓存失败: ${e.message}`)
      return []
    }
  }

  /**
   * 发送API请求
   * @async
   * @template T - 响应数据类型
   * @param {string} url - 请求URL
   * @param {Object} options - 请求选项
   * @param {string} [options.method='get'] - 请求方法
   * @param {any} [options.data] - 请求数据
   * @param {FormData} [options.formData] - 表单数据
   * @param {string} [options.responseType='json'] - 响应类型
   * @param {number} [options.timeout=8000] - 超时时间(毫秒)
   * @returns {Promise<T|null>} 响应数据或null
   */
  async apiRequest<T = any>(url: string, options: {
    method?: 'get' | 'post',
    data?: any,
    formData?: FormData,
    responseType?: 'json' | 'arraybuffer',
    timeout?: number
  } = {}): Promise<T | null> {
    const {
      method = 'get',
      data,
      formData,
      responseType = 'json',
      timeout = 8000
    } = options
    try {
      const response = await axios({
        url,
        method,
        data: formData || data,
        headers: formData ? { 'Accept': 'image/*,application/json' } : undefined,
        responseType: responseType === 'arraybuffer' ? 'arraybuffer' : 'json',
        timeout,
        validateStatus: () => true
      })
      if (response.status !== 200) {
        let errorMessage = `HTTP状态码 ${response.status}`
        if (responseType === 'arraybuffer') {
          try {
            const errText = Buffer.from(response.data).toString('utf-8')
            const errJson = JSON.parse(errText)
            errorMessage = errJson.error || errJson.message || errorMessage
          } catch {}
        } else if (response.data) {
          errorMessage = response.data.error || response.data.message || errorMessage
        }
        this.logger.warn(`API请求失败: ${url} - ${errorMessage}`)
        return null
      }
      return response.data as T
    } catch (e) {
      this.logger.error(`API请求异常: ${url} - ${e.message}`)
      return null
    }
  }

  /**
   * 获取模板详细信息
   * @async
   * @param {MemeInfo} template - 模板信息
   * @returns {Promise<{id: string, keywords: string[], imgReq: string, textReq: string, tags: string[]}>} 格式化后的模板详情
   */
  async getTemplateDetails(template: MemeInfo) {
    const { id, keywords = [], tags = [], params_type: pt = {} } = template
    const formatReq = (min?: number, max?: number, type: string = '') => {
      if (min === max && min) return `${type}${min}`
      if (min || max) return `${type}${min || 0}-${max || '∞'}`
      return ''
    }
    const imgReq = formatReq(pt.min_images, pt.max_images, '图片')
    const textReq = formatReq(pt.min_texts, pt.max_texts, '文本')
    return { id, keywords, imgReq, textReq, tags }
  }

  /**
   * 验证参数是否符合模板要求
   * @private
   * @param {Object} params - 验证参数
   * @param {number} params.imageCount - 实际图片数量
   * @param {number} params.minImages - 最少需要的图片数量
   * @param {number} params.maxImages - 最多允许的图片数量
   * @param {number} params.textCount - 实际文本数量
   * @param {number} params.minTexts - 最少需要的文本数量
   * @param {number} params.maxTexts - 最多允许的文本数量
   * @throws {Error} 当参数不符合要求时抛出错误
   */
  private validateParams({
    imageCount, minImages, maxImages,
    textCount, minTexts, maxTexts
  }: {
    imageCount: number, minImages: number, maxImages: number,
    textCount: number, minTexts: number, maxTexts: number
  }): void {
    const formatRange = (min: number, max: number): string => {
      if (min === max) return `${min}`
      if (min != null && max != null) return `${min}~${max}`
      if (min != null) return `至少${min}`
      if (max != null) return `最多${max}`
      return ''
    };
    const checkCount = (count: number, min: number, max: number, type: string): void => {
      if ((min != null && count < min) || (max != null && min != null && count > max)) {
        const range = formatRange(min, max);
        throw new Error(`当前${count}${type === '图片' ? '张' : '条'}${type}，需要${range}${type === '图片' ? '张' : '条'}${type}`);
      }
    }
    checkCount(imageCount, minImages, maxImages, '图片');
    checkCount(textCount, minTexts, maxTexts, '文本');
  }

  /**
   * 匹配模板关键词
   * @private
   * @param {string} key - 搜索关键词
   * @returns {MemeInfo[]} 按匹配度排序的模板数组
   */
  matchTemplates(key: string): MemeInfo[] {
    if (!key || !this.memeCache.length) return [];
    const getPriority = (template: MemeInfo): number => {
      if (template.id === key || template.keywords?.some(k => k === key)) return 1; // 完全匹配
      if (template.keywords?.some(k => k.includes(key))) return 2; // 关键词包含搜索词
      if (template.keywords?.some(k => key.includes(k))) return 3; // 搜索词包含关键词
      if (template.id.includes(key)) return 4; // ID包含搜索词
      if (template.tags?.some(tag => tag === key || tag.includes(key))) return 5; // 标签匹配
      return 99; // 不匹配
    };
    // 过滤和排序
    return this.memeCache
      .map(template => ({ template, priority: getPriority(template) }))
      .filter(item => item.priority < 99) // 只保留匹配的模板
      .sort((a, b) => a.priority - b.priority) // 按优先级排序
      .map(item => item.template);
  }

  /**
   * 查找表情包模板
   * @param {string} key - 模板ID或关键词
   * @param {boolean} [fuzzy=true] - 是否进行模糊匹配
   * @returns {Promise<MemeInfo|null>} 找到的模板信息或null
   */
  async findTemplate(key: string, fuzzy: boolean = true): Promise<MemeInfo | null> {
    const matchedTemplates = fuzzy ? this.matchTemplates(key) :
      this.memeCache.filter(t => t.id === key || t.keywords?.some(k => k === key));
    // 返回最匹配的
    if (matchedTemplates.length > 0) {
      return matchedTemplates[0];
    }
    // 尝试从API获取
    if (this.apiUrl) {
      try {
        const info = await this.apiRequest<any>(`${this.apiUrl}/memes/${key}/info`);
        if (info) {
          this.refreshCache().catch(e => {
            this.logger.warn(`刷新缓存失败: ${e.message}`);
          });
          return {
            id: key,
            keywords: info.keywords ?
              (Array.isArray(info.keywords) ? info.keywords : [info.keywords]).filter(Boolean) : [],
            tags: info.tags && Array.isArray(info.tags) ? info.tags : [],
            params_type: info.params_type || {},
            ...(info || {})
          };
        }
      } catch (e) {
        this.logger.warn(`从API获取模板[${key}]信息失败：${e.message}`);
      }
    }
    return null;
  }

  /**
   * 获取所有关键词到模板ID的映射
   * @returns {Map<string, string>} 关键词到模板ID的映射
   */
  getAllKeywordMappings(): Map<string, string> {
    const keywordMap = new Map<string, string>();
    for (const template of this.memeCache) {
      keywordMap.set(template.id, template.id);
      if (template.keywords && Array.isArray(template.keywords)) {
        for (const keyword of template.keywords) {
          if (keyword) keywordMap.set(keyword, template.id);
        }
      }
    }
    return keywordMap;
  }

  /**
   * 生成表情包
   * @async
   * @param {any} session - 会话上下文
   * @param {string} key - 模板ID或关键词
   * @param {h[]} args - 参数元素数组
   * @returns {Promise<h|string>} 生成的图片元素或错误信息
   */
  async generateMeme(session: any, key: string, args: h[]) {
    try {
      const templateInfo = await this.findTemplate(key);
      if (!templateInfo) {
        return autoRecall(session, `获取模板信息失败: ${key}`);
      }
      const tempId = templateInfo.id || key;
      const {
        min_images = 0, max_images = 0,
        min_texts = 0, max_texts = 0,
        default_texts = []
      } = templateInfo.params_type || {};
      // 解析参数
      const { imageInfos: origImageInfos, texts: origTexts, options } =
        await this.parseArgs(session, args, templateInfo)
          .catch(e => { throw new Error(`参数解析失败: ${e.message}`) })
      // 添加用户头像和默认文本
      let imageInfos = [...origImageInfos]
      let texts = [...origTexts]
      const needSelfAvatar = (min_images === 1 && !imageInfos.length) ||
                            (imageInfos.length && imageInfos.length + 1 === min_images)
      if (needSelfAvatar) {
        imageInfos = [{ userId: session.userId }, ...imageInfos]
      }
      if (!texts.length && default_texts.length) {
        texts = [...default_texts]
      }
      // 验证参数
      try {
        this.validateParams({
          imageCount: imageInfos.length, minImages: min_images, maxImages: max_images,
          textCount: texts.length, minTexts: min_texts, maxTexts: max_texts
        });
      } catch (e) {
        return autoRecall(session, e.message);
      }
      // 获取图片和用户信息
      const imagesAndInfos = await this.fetchImages(session, imageInfos)
        .catch(e => { throw new Error(`获取图片失败: ${e.message}`) })
      // 生成表情包
      const imageBuffer = await this.renderMeme(tempId, texts, imagesAndInfos, options)
        .catch(e => { throw new Error(`生成表情失败: ${e.message}`) })
      return h('image', { url: `data:image/png;base64,${Buffer.from(imageBuffer).toString('base64')}` })
    } catch (e) {
      return autoRecall(session, e.message)
    }
  }

  /**
   * 解析命令参数
   * @private
   * @async
   * @param {any} session - 会话上下文
   * @param {h[]} args - 参数元素数组
   * @param {MemeInfo} templateInfo - 模板信息
   * @returns {Promise<ResolvedArgs>} 解析后的参数
   */
  private async parseArgs(session: any, args: h[], templateInfo: MemeInfo): Promise<ResolvedArgs> {
    const imageInfos: ImageFetchInfo[] = []
    const texts: string[] = []
    const options: Record<string, any> = {}
    const processedAtIds = new Set<string>()
    let allText = ''
    // 处理用户ID
    const processUserId = (userId: string): boolean => {
      if (userId && !processedAtIds.has(userId)) {
        imageInfos.push({ userId })
        processedAtIds.add(userId)
        return true
      }
      return false
    }
    // 处理引用消息中的图片
    if (session.quote?.elements) {
      const processQuoteElement = (e: h) => {
        if (e.type === 'img' && e.attrs.src) imageInfos.push({ src: e.attrs.src })
        if (e.children?.length) e.children.forEach(processQuoteElement)
      }
      session.quote.elements.forEach(processQuoteElement)
    }
    // 处理文本内容中的标签
    const processTextContent = (content: string): string => {
      // 处理at标签
      let processedContent = content.replace(/<at id=['"]?([0-9]+)['"]?\/>/g, (match, userId) => {
        processUserId(userId)
        return ' '
      })
      // 处理img标签
      processedContent = processedContent.replace(/<img[^>]*src=['"]([^'"]+)['"][^>]*\/?>/g, (match, src) => {
        if (src) {
          imageInfos.push({ src })
        }
        return ' '
      })
      return processedContent
    }
    // 递归处理元素
    const processElement = (e: h): void => {
      if (e.type === 'text' && e.attrs.content) {
        allText += processTextContent(e.attrs.content) + ' '
      } else if (e.type === 'at' && e.attrs.id) {
        processUserId(e.attrs.id)
      } else if (e.type === 'img' && e.attrs.src) {
        imageInfos.push({ src: e.attrs.src })
      }
      if (e.children?.length) e.children.forEach(processElement)
    }
    // 处理所有参数元素
    args.forEach(processElement)
    // 解析文本参数
    if (allText.trim()) {
      const tokens = allText.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
      tokens.forEach(token => {
        // 选项参数
        if (token.startsWith('-')) {
          const optMatch = token.match(/^-([a-zA-Z0-9_-]+)(?:=(.*))?$/)
          if (optMatch) {
            const [, key, rawValue = 'true'] = optMatch
            let value: any = rawValue
            if (rawValue === 'true') value = true
            else if (rawValue === 'false') value = false
            else if (/^-?\d+$/.test(rawValue)) value = parseInt(rawValue, 10)
            else if (/^-?\d+\.\d+$/.test(rawValue)) value = parseFloat(rawValue)
            options[key] = value
          }
        }
        // at文本
        else if (token.startsWith('<at') || token.startsWith('@')) {
          const userId = token.startsWith('<at') ? parseTarget(token) : token.match(/@(\d+)/)?.[1]
          if (userId) {
            processUserId(userId)
          } else if (token.startsWith('@')) {
            texts.push(token)
          }
        }
        // 普通文本
        else {
          const trimmedToken = token.replace(/^(['"])(.*)\1$/, '$2')
          texts.push(trimmedToken)
        }
      })
    }
    // 转换选项类型
    const properties = templateInfo?.params_type?.args_type?.args_model?.properties || {}
    for (const key in properties) {
      if (key in options && key !== 'user_infos') {
        const prop = properties[key]
        const value = options[key]
        if (prop.type === 'integer' && typeof value !== 'number')
          options[key] = parseInt(String(value), 10)
        else if (prop.type === 'number' && typeof value !== 'number')
          options[key] = parseFloat(String(value))
        else if (prop.type === 'boolean' && typeof value !== 'boolean')
          options[key] = value === 'true' || value === '1' || value === 1
      }
    }
    return { imageInfos, texts, options }
  }

  /**
   * 获取图片和用户信息
   * @private
   * @async
   * @param {any} session - 会话上下文
   * @param {ImageFetchInfo[]} imageInfos - 图片来源信息
   * @returns {Promise<ImagesAndInfos>} 获取到的图片和用户信息
   * @throws {Error} 获取图片失败时抛出错误
   */
  private async fetchImages(session: any, imageInfos: ImageFetchInfo[]): Promise<ImagesAndInfos> {
    const imageInfoKeys = imageInfos.map(v => JSON.stringify(v))
    const imageMap: Record<string, Blob> = {}
    const userInfoMap: Record<string, any> = {}
    const uniqueKeys = [...new Set(imageInfoKeys)]
    await Promise.all(uniqueKeys.map(async (key) => {
      const info = JSON.parse(key)
      let url: string
      let userInfo: any = {}
      if ('src' in info) {
        url = info.src
      } else if ('userId' in info) {
        // 这里调用getUserAvatar来获取用户头像URL
        url = await getUserAvatar(session, info.userId)
        userInfo = { name: info.userId }
      }
      // 接下来使用获取到的URL下载实际图片
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 })
      const buffer = Buffer.from(response.data)
      const contentType = response.headers['content-type'] || 'image/png'
      imageMap[key] = new Blob([buffer], { type: contentType })
      userInfoMap[key] = userInfo
    }))
    return {
      images: imageInfoKeys.map(key => imageMap[key]),
      userInfos: imageInfoKeys.map(key => userInfoMap[key])
    }
  }

  /**
   * 渲染表情包
   * @private
   * @async
   * @param {string} tempId - 模板ID
   * @param {string[]} texts - 文本参数
   * @param {ImagesAndInfos} imagesAndInfos - 图片和用户信息
   * @param {Record<string, any>} options - 其他选项
   * @returns {Promise<Buffer>} 生成的图片数据
   */
  private async renderMeme(
    tempId: string,
    texts: string[],
    imagesAndInfos: ImagesAndInfos,
    options: Record<string, any>
  ): Promise<Buffer> {
    const formData = new FormData()
    texts.forEach(text => formData.append('texts', text))
    imagesAndInfos.images.forEach(img => formData.append('images', img))
    formData.append('args', JSON.stringify({ user_infos: imagesAndInfos.userInfos, ...options }))
    return this.apiRequest<Buffer>(`${this.apiUrl}/memes/${tempId}/`, {
      method: 'post',
      formData,
      responseType: 'arraybuffer',
      timeout: 10000
    })
  }
}
