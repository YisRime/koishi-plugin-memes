import { Context, h, Logger } from 'koishi'
import axios from 'axios'
import fs from 'fs'
import path from 'path'

// 表情模板信息接口
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

export class MemeGenerator {
  private ctx: Context
  private apiUrl: string
  private logger: Logger
  private memeCache: MemeInfo[] = []
  private lastCacheTime = 0

  constructor(ctx: Context, logger: Logger, apiUrl: string) {
    this.ctx = ctx
    this.logger = logger
    this.apiUrl = !apiUrl ? '' : apiUrl.trim().replace(/\/+$/, '')
    this.initCache()
  }

  // 初始化缓存
  private async initCache() {
    if (!this.apiUrl) return
    this.memeCache = await this.loadCache()
    if (this.memeCache.length > 0) {
      this.logger.info(`已加载缓存文件：${this.memeCache.length}项`)
    } else {
      await this.refreshCache()
    }
  }

  /**
   * 加载缓存
   */
  private async loadCache(): Promise<MemeInfo[]> {
    const cachePath = path.resolve(this.ctx.baseDir, 'data', 'memes.json')
    if (fs.existsSync(cachePath)) {
      try {
        const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
        if (cacheData.time && cacheData.data) {
          this.lastCacheTime = cacheData.time
          return cacheData.data
        }
      } catch (e) {
        this.logger.warn(`读取缓存失败: ${e.message}`)
      }
    }
    return []
  }

  /**
   * 保存缓存
   */
  private async saveCache(data: MemeInfo[]): Promise<void> {
    const cachePath = path.resolve(this.ctx.baseDir, 'data', 'memes.json')
    this.lastCacheTime = Date.now()
    const cacheData = {
      time: this.lastCacheTime,
      data: data
    }
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8')
    this.logger.info(`已创建缓存文件：${data.length}项`)
  }

  /**
   * 刷新缓存
   */
  async refreshCache(): Promise<MemeInfo[]> {
    try {
      const keys = await this.apiRequest<string[]>(`${this.apiUrl}/memes/keys`)
      if (!keys || !keys.length) {
        this.logger.warn(`获取模板列表失败或为空`)
        return []
      }
      this.logger.info(`已获取模板ID: ${keys.length}个`)
      const templates: MemeInfo[] = []
      for (const key of keys) {
        try {
          const info = await this.apiRequest<any>(`${this.apiUrl}/memes/${key}/info`)
          templates.push({
            id: key,
            keywords: info?.keywords ? (Array.isArray(info.keywords) ? info.keywords : [info.keywords]).filter(Boolean) : [],
            tags: info?.tags && Array.isArray(info.tags) ? info.tags : [],
            params_type: info?.params_type || {},
            ...(info || {})
          })
        } catch (e) {
          this.logger.warn(`获取模板[${key}]信息失败：${e.message}`)
          templates.push({ id: key, keywords: [], tags: [], params_type: {} })
        }
      }
      await this.saveCache(templates)
      this.memeCache = templates
      return templates
    } catch (e) {
      this.logger.error(`刷新缓存失败: ${e.message}`)
      return []
    }
  }

  /**
   * 通用API请求函数
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
   * 解析目标用户ID
   */
  parseTarget(arg: string): string {
    // 尝试解析at元素
    try {
      const atElement = h.select(h.parse(arg), 'at')[0]
      if (atElement?.attrs?.id) return atElement.attrs.id
    } catch {}
    // 尝试匹配@数字或纯数字格式
    const match = arg.match(/@(\d+)/)
    if (match) return match[1]
    // 判断是否为纯数字ID
    if (/^\d+$/.test(arg.trim())) {
      const userId = arg.trim()
      if (/^\d{5,10}$/.test(userId)) return userId
    }
    return arg
  }

  /**
   * 获取用户头像URL
   */
  async getUserAvatar(session: any, userId?: string): Promise<string> {
    const targetId = userId || session.userId
    return (targetId === session.userId && session.user?.avatar) ?
      session.user.avatar :
      `https://q1.qlogo.cn/g?b=qq&nk=${targetId}&s=640`
  }

  /**
   * 自动撤回消息
   */
  async autoRecall(session: any, message: string | number, delay: number = 10000): Promise<any> {
    if (!message) return null
    try {
      const msg = typeof message === 'string' ? await session.send(message) : message
      setTimeout(async () => {
        await session.bot?.deleteMessage(session.channelId, msg.toString())
      }, delay)
      return null
    } catch (error) {
      this.logger.debug(`消息处理失败：${error}`)
      return null
    }
  }

  /**
   * 通用范围验证函数
   */
  validateRange(value: number, min: number, max: number, type: string, unit: string): string | null {
    const valid = (min == null || value >= min) && (max == null || value <= max)
    if (valid) return null
    let rangeText: string
    let errorType: string
    if (min === max && min != null) {
      rangeText = `${min}${unit}`
      errorType = '数量不符'
    } else if (min != null && max != null) {
      rangeText = `${min}~${max}${unit}`
      errorType = value < min ? '数量不足' : '数量过多'
    } else if (min != null) {
      rangeText = `至少${min}${unit}`
      errorType = '数量不足'
    } else if (max != null) {
      rangeText = `最多${max}${unit}`
      errorType = '数量过多'
    } else {
      return `${type}数量错误！当前: ${value}${unit}`
    }
    return `${type}${errorType}！当前: ${value}${unit}，需要: ${rangeText}`
  }

  /**
   * 处理命令参数并提取图片、文本和选项
   */
  private async processArgs(session: any, args: h[], templateInfo?: MemeInfo) {
    const imageInfos: Array<{ src: string } | { userId: string }> = []
    const texts: string[] = []
    let options: Record<string, string> = {}
    // 预处理模板参数定义
    let paramOptions: Map<string, {dest: string, action: any}> = new Map()
    if (templateInfo?.params_type?.args_type?.parser_options) {
      for (const opt of templateInfo.params_type.args_type.parser_options) {
        if (opt.names && opt.names.length) {
          // 为每个别名创建映射
          for (const name of opt.names) {
            // 移除前缀 -- 或 -
            const cleanName = name.replace(/^(--)|-/g, '')
            paramOptions.set(cleanName, {
              dest: opt.dest || cleanName,
              action: opt.action || { type: 0, value: true }
            })
          }
        }
      }
    }
    // 添加引用消息中的图片
    if (session.quote?.elements) {
      const processElement = (e: h) => {
        if (e.children?.length) {
          for (const child of e.children) processElement(child)
        }
        if (e.type === 'img' && e.attrs.src) {
          imageInfos.push({ src: e.attrs.src })
        }
      }
      for (const element of session.quote.elements) {
        processElement(element)
      }
    }
    // 处理参数中的图片和文本
    const textBuffer: string[] = []
    const resolveBuffer = () => {
      if (!textBuffer.length) return
      const text = textBuffer.join('')
      // 提取选项
      const extractedOptions: Record<string, string> = {}
      const cleanText = text.replace(/(?:--)([a-zA-Z0-9_]+)(?:=([^\s]+))?|(\p{Script=Han}+)(?:=([^\s]+))?/gu,
        (match, key1, value1, key2, value2) => {
          const key = key1 || key2
          const value = value1 || value2 || 'true'
          if (key) {
            extractedOptions[key] = value
          }
          return ''
        }).trim()
      // 处理从文本中提取的选项
      for (const [key, value] of Object.entries(extractedOptions)) {
        const paramDef = paramOptions.get(key)
        if (paramDef) {
          const destKey = paramDef.dest || key
          if (paramDef.action && paramDef.action.type === 0) {
            options[destKey] = value === 'false' ? 'false' : 'true'
          } else {
            options[destKey] = value
          }
        } else {
          options[key] = value
        }
      }
      // 处理@标签和普通文本
      const atRegex = /<at\s+id="(\d+)"\s*\/>/g
      let match
      let lastIndex = 0
      let hasAtTag = false
      const textToProcess = cleanText || text
      // 查找所有 at 标签
      while ((match = atRegex.exec(textToProcess)) !== null) {
        hasAtTag = true
        // 处理 at 标签前的文本
        if (match.index > lastIndex) {
          const segment = textToProcess.substring(lastIndex, match.index)
          const segmentTexts = (() => {
            const matched = segment.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g)
            if (!matched) return []
            return matched.map(v => v.replace(/^["']|["']$/g, ''))
          })().filter(v => {
            if (v.startsWith('@')) {
              imageInfos.push({ userId: this.parseTarget(v) })
              return false
            }
            return !!v.trim()
          })
          texts.push(...segmentTexts)
        }
        // 处理 at 标签
        imageInfos.push({ userId: match[1] })
        lastIndex = match.index + match[0].length
      }
      // 处理无at标签或at标签后的文本
      if (!hasAtTag || lastIndex < textToProcess.length) {
        const remainingText = hasAtTag ? textToProcess.substring(lastIndex) : textToProcess
        const bufferTexts = (() => {
          const matched = remainingText.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g)
          if (!matched) return []
          return matched.map(v => v.replace(/^["']|["']$/g, ''))
        })().filter(v => {
          if (v.startsWith('@')) {
            imageInfos.push({ userId: this.parseTarget(v) })
            return false
          }
          return !!v.trim()
        })
        texts.push(...bufferTexts)
      }
      textBuffer.length = 0
    }
    // 递归处理元素
    const processElement = (e: h) => {
      if (e.children?.length) {
        for (const child of e.children) processElement(child)
      }
      if (e.type === 'text') {
        if (e.attrs.content) textBuffer.push(e.attrs.content)
        return
      }
      resolveBuffer()
      if (e.type === 'img' && e.attrs.src) {
        imageInfos.push({ src: e.attrs.src })
      } else if (e.type === 'at' && e.attrs.id) {
        imageInfos.push({ userId: e.attrs.id })
      }
    }
    for (const element of args) {
      processElement(element)
    }
    resolveBuffer()
    // 转换选项值类型
    const typedOptions: Record<string, any> = {}
    // 有模型定义时，按定义类型转换
    if (templateInfo?.params_type?.args_type?.args_model?.properties) {
      const properties = templateInfo.params_type.args_type.args_model.properties
      for (const [key, value] of Object.entries(options)) {
        if (key === 'user_infos') continue
        if (properties[key]) {
          const prop = properties[key]
          if (prop.type === 'integer' || prop.type === 'number') {
            typedOptions[key] = Number(value)
          } else if (prop.type === 'boolean') {
            typedOptions[key] = value === 'true'
          } else {
            typedOptions[key] = value
          }
        } else {
          typedOptions[key] = value
        }
      }
    } else {
      // 无模型定义时，进行基本类型推断
      for (const [key, value] of Object.entries(options)) {
        if (value === 'true') typedOptions[key] = true
        else if (value === 'false') typedOptions[key] = false
        else if (/^-?\d+$/.test(value)) typedOptions[key] = parseInt(value)
        else if (/^-?\d+\.\d+$/.test(value)) typedOptions[key] = parseFloat(value)
        else typedOptions[key] = value
      }
    }
    return { imageInfos, texts, options: typedOptions }
  }

  /**
   * 处理模板参数并验证
   */
  private async processTemplateParameters(session: any, key: string, args: h[]) {
    let templateInfo = this.memeCache.find(t => t.id === key)
    if (!templateInfo) {
      templateInfo = await this.apiRequest(`${this.apiUrl}/memes/${key}/info`)
      if (!templateInfo) {
        return this.autoRecall(session, `获取模板信息失败: ${key}`)
      }
    }
    const paramsType = templateInfo.params_type || {}
    const {
      min_images: minImages = 0,
      max_images: maxImages = 0,
      min_texts: minTexts = 0,
      max_texts: maxTexts = 0,
      default_texts: defaultTexts = []
    } = paramsType
    // 解析参数
    const hArgs = args.map(arg => typeof arg === 'string' ? h('text', { content: arg }) : arg)
    const { imageInfos, texts, options } = await this.processArgs(session, hArgs, templateInfo)
    // 处理图片和文本
    let processedImageInfos = [...imageInfos]
    let processedTexts = [...texts]
    // 自动使用发送者头像
    const autoUseAvatar = !!(
      (!imageInfos.length && minImages === 1) ||
      (imageInfos.length && imageInfos.length + 1 === minImages)
    )
    if (autoUseAvatar) {
      processedImageInfos.unshift({ userId: session.userId })
    }
    // 使用默认文本
    if (!texts.length) {
      processedTexts.push(...defaultTexts)
    }
    // 验证参数
    const imagesError = this.validateRange(processedImageInfos.length, minImages, maxImages, "图片", "张")
    if (imagesError) return this.autoRecall(session, imagesError)
    const textsError = this.validateRange(processedTexts.length, minTexts, maxTexts, "文本", "条")
    if (textsError) return this.autoRecall(session, textsError)
    // 处理图片和用户信息
    const images: Blob[] = []
    const userInfos: any[] = []
    for (const info of processedImageInfos) {
      let imageUrl: string
      let userInfo = {}
      if ('src' in info) {
        imageUrl = info.src
      } else if ('userId' in info) {
        imageUrl = await this.getUserAvatar(session, info.userId)
        userInfo = { name: info.userId }
      } else {
        continue
      }
      try {
        const response = await axios.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 8000
        })
        const buffer = Buffer.from(response.data)
        const blob = new Blob([buffer], { type: response.headers['content-type'] || 'image/png' })
        images.push(blob)
        userInfos.push(userInfo)
      } catch (e) {
        this.logger.error(`获取图片失败: ${imageUrl} - ${e.message}`)
        return this.autoRecall(session, `获取图片失败: ${imageUrl}`)
      }
    }
    return { templateInfo, images, texts: processedTexts, userInfos, templateOptions: options }
  }

  /**
   * 获取模板详情
   */
  async getTemplateDetails(template: MemeInfo) {
    const info = template
    const keywords = info.keywords || []
    const tags = info.tags || []
    const pt = info.params_type || {}
    let imgReq = ''
    let textReq = ''
    if (pt.min_images === pt.max_images) {
      imgReq = pt.min_images > 0 ? `图片${pt.min_images}` : ''
    } else {
      imgReq = pt.min_images > 0 || pt.max_images > 0 ? `图片${pt.min_images}-${pt.max_images}` : ''
    }
    if (pt.min_texts === pt.max_texts) {
      textReq = pt.min_texts > 0 ? `文本${pt.min_texts}` : ''
    } else {
      textReq = pt.min_texts > 0 || pt.max_texts > 0 ? `文本${pt.min_texts}-${pt.max_texts}` : ''
    }
    return {
      id: template.id,
      keywords,
      imgReq,
      textReq,
      tags
    }
  }

  /**
   * 生成表情包图片
   */
  async generateMeme(session: any, key: string, args: h[]) {
    if (!key) {
      return this.autoRecall(session, '请提供模板ID和文本参数')
    }
    try {
      // 处理模板参数
      const result = await this.processTemplateParameters(session, key, args)
      if (!result) return
      const { images, texts, userInfos, templateOptions } = result
      this.logger.debug(`正在生成表情: ${key}, 文本数量: ${texts.length}, 图片数量: ${images.length}`)
      // 准备请求数据
      const formData = new FormData()
      texts.forEach(text => formData.append('texts', text))
      images.forEach(img => formData.append('images', img))
      const memeArgs = {
        user_infos: userInfos,
        ...templateOptions
      }
      formData.append('args', JSON.stringify(memeArgs))
      // 请求生成表情包
      const imageBuffer = await this.apiRequest<Buffer>(`${this.apiUrl}/memes/${key}/`, {
        method: 'post',
        formData,
        responseType: 'arraybuffer',
        timeout: 10000
      })
      if (!imageBuffer) {
        this.logger.error(`生成表情失败: ${key} - API返回空结果`)
        return this.autoRecall(session, `生成表情失败: ${key}`)
      }
      // 返回图片
      const base64 = Buffer.from(imageBuffer).toString('base64')
      return h('image', { url: `data:image/png;base64,${base64}` })
    } catch (e) {
      this.logger.error(`生成表情出错: ${e.message}`)
      return this.autoRecall(session, `生成表情出错: ${e.message}`)
    }
  }

  /**
   * 计算字符串显示宽度（中文字符宽度2，英文字符宽度1）
   */
  private getStringDisplayWidth(str: string): number {
    let width = 0
    for (let i = 0; i < str.length; i++) {
      if (/[\u4e00-\u9fa5\uff00-\uffff]/.test(str[i])) {
        width += 2
      } else {
        width += 1
      }
    }
    return width
  }

  /**
   * 获取表情包列表
   */
  async getMemeList(page?: string) {
    try {
      let keys: string[]
      if (this.memeCache.length > 0) {
        keys = this.memeCache.map(t => t.id)
      } else {
        const apiKeys = await this.apiRequest<string[]>(`${this.apiUrl}/memes/keys`)
        if (!apiKeys) {
          return null
        }
        keys = apiKeys
      }
      // 获取所有模板详情
      const allTemplates = await Promise.all(keys.map(async (key) => {
        const cachedTemplate = this.memeCache.find(t => t.id === key)
        if (cachedTemplate) {
          return this.getTemplateDetails(cachedTemplate)
        } else {
          try {
            const info = await this.apiRequest(`${this.apiUrl}/memes/${key}/info`)
            if (!info) return { id: key, keywords: [], imgReq: '', textReq: '', tags: [] }
            return this.getTemplateDetails({
              id: key,
              keywords: info.keywords ? (Array.isArray(info.keywords) ? info.keywords : [info.keywords]) : [],
              tags: info.tags && Array.isArray(info.tags) ? info.tags : [],
              params_type: info.params_type || {}
            })
          } catch (err) {
            return { id: key, keywords: [], imgReq: '', textReq: '', tags: [] }
          }
        }
      }))
      // 收集所有模板的关键词
      const allKeywords: string[] = []
      allTemplates.forEach(template => {
        if (template.keywords.length > 0) {
          allKeywords.push(...template.keywords)
        } else {
          allKeywords.push(template.id)
        }
      })
      // 格式化为行，尽可能多地在一行中放置关键词
      const formattedLines: string[] = []
      let currentLine = ''
      for (const keyword of allKeywords) {
        // 检查添加这个关键词后是否会超出最大宽度
        const separator = currentLine ? ' ' : ''
        if (this.getStringDisplayWidth(currentLine + separator + keyword) <= 36) {
          currentLine += separator + keyword
        } else {
          // 如果会超出，就把当前行添加到结果中，然后开始新行
          formattedLines.push(currentLine)
          currentLine = keyword
        }
      }
      // 添加最后一行
      if (currentLine) {
        formattedLines.push(currentLine)
      }
      // 分页处理
      const LINES_PER_PAGE = 10
      const showAll = page === 'all'
      const pageNum = typeof page === 'string' ? (parseInt(page) || 1) : (page || 1)
      const totalPages = Math.ceil(formattedLines.length / LINES_PER_PAGE)
      const validPage = Math.max(1, Math.min(pageNum, totalPages))
      const displayLines = showAll
        ? formattedLines
        : formattedLines.slice((validPage - 1) * LINES_PER_PAGE, validPage * LINES_PER_PAGE)
      return {
        keys,
        totalTemplates: allTemplates.length,
        totalKeywords: allKeywords.length,
        displayLines,
        totalPages,
        validPage,
        showAll
      }
    } catch (err) {
      this.logger.error(`列出模板失败: ${err.message}`)
      return null
    }
  }

  /**
   * 获取表情包模板信息
   */
  async getMemeInfo(key: string) {
    try {
      // 先尝试直接匹配ID
      let template = this.memeCache.find(t => t.id === key)
      // 如果不是ID，尝试匹配关键词
      if (!template) {
        const matches = this.memeCache.filter(t =>
          t.keywords.some(k => k.includes(key)) ||
          t.tags.some(t => t.includes(key))
        )
        if (matches.length > 0) {
          template = matches[0]
          // 如果找到多个匹配项，添加提示信息到模板
          if (matches.length > 1) {
            template = { ...template, _multipleMatches: matches.length }
          }
        }
      }
      // 获取模板信息
      let info
      if (template) {
        info = template
      } else {
        info = await this.apiRequest(`${this.apiUrl}/memes/${key}/info`)
        if (!info) {
          return null
        }
      }
      // 预览图
      let previewImage = null
      try {
        const previewImageBuffer = await this.apiRequest<Buffer>(
          `${this.apiUrl}/memes/${template?.id || key}/preview`,
          {
            responseType: 'arraybuffer',
            timeout: 8000
          }
        );
        if (previewImageBuffer) {
          previewImage = previewImageBuffer;
        }
      } catch (previewErr) {
        this.logger.warn(`获取预览图失败: ${template?.id || key} - ${previewErr.message}`);
      }
      return { info, previewImage, searchKey: key, templateId: template?.id || key }
    } catch (err) {
      this.logger.error(`获取模板信息失败: ${key} - ${err.message}`)
      return null
    }
  }

  /**
   * 搜索表情模板
   */
  async searchMeme(keyword: string) {
    try {
      if (this.memeCache.length === 0) {
        await this.refreshCache()
      }
      return this.memeCache.filter(template =>
        template.keywords.some(k => k.includes(keyword)) ||
        template.tags.some(t => t.includes(keyword)) ||
        template.id.includes(keyword)
      )
    } catch (err) {
      this.logger.error(`搜索模板失败: ${keyword} - ${err.message}`)
      return null
    }
  }
}
