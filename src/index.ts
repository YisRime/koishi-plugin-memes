import { Context, Schema, h, Logger } from 'koishi'
import { MemeAPI } from './api'
import { MemeMaker } from './make'
import axios from 'axios'
import fs from 'fs'
import path from 'path'

export const name = 'memes'
export const inject = {optional: ['puppeteer']}
export const logger = new Logger('memes')

export interface Config {
  loadApi: boolean
  genUrl: string
}

export const Config: Schema<Config> = Schema.object({
  loadApi: Schema.boolean()
    .description('开启自定义 API 生成功能').default(false),
  genUrl: Schema.string()
    .description('MemeGenerator API 配置').default('http://localhost:2233')
})

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

// 缓存相关
let memeCache: MemeInfo[] = []
let lastCacheTime = 0

/**
 * 加载缓存
 */
async function loadCache(ctx: Context): Promise<MemeInfo[]> {
  const cachePath = path.resolve(ctx.baseDir, 'data', 'memes.json')
  if (fs.existsSync(cachePath)) {
    try {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
      if (cacheData.time && cacheData.data) {
        lastCacheTime = cacheData.time
        return cacheData.data
      }
    } catch (e) {
      logger.warn(`读取缓存失败: ${e.message}`)
    }
  }
  return []
}

/**
 * 保存缓存
 */
async function saveCache(ctx: Context, data: MemeInfo[]): Promise<void> {
  const cachePath = path.resolve(ctx.baseDir, 'data', 'memes.json')
  lastCacheTime = Date.now()
  const cacheData = {
    time: lastCacheTime,
    data: data
  }
  fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8')
  logger.info(`已创建缓存文件：${data.length}项`)
}

/**
 * 刷新缓存
 */
async function refreshCache(ctx: Context, apiUrl: string): Promise<MemeInfo[]> {
  try {
    const keys = await apiRequest<string[]>(`${apiUrl}/memes/keys`)
    if (!keys || !keys.length) {
      logger.warn(`获取模板列表失败或为空`)
      return []
    }
    logger.info(`已获取模板ID: ${keys.length}个`)
    const templates: MemeInfo[] = []
    for (const key of keys) {
      try {
        const info = await apiRequest<any>(`${apiUrl}/memes/${key}/info`)
        templates.push({
          id: key,
          keywords: info?.keywords ? (Array.isArray(info.keywords) ? info.keywords : [info.keywords]).filter(Boolean) : [],
          tags: info?.tags && Array.isArray(info.tags) ? info.tags : [],
          params_type: info?.params_type || {},
          ...(info || {})
        })
      } catch (e) {
        logger.warn(`获取模板[${key}]信息失败：${e.message}`)
        templates.push({ id: key, keywords: [], tags: [], params_type: {} })
      }
    }
    await saveCache(ctx, templates)
    memeCache = templates
    return templates
  } catch (e) {
    logger.error(`刷新缓存失败: ${e.message}`)
    return []
  }
}

/**
 * 解析目标用户ID
 */
export function parseTarget(arg: string): string {
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
export async function getUserAvatar(session: any, userId?: string): Promise<string> {
  const targetId = userId || session.userId
  return (targetId === session.userId && session.user?.avatar) ?
    session.user.avatar :
    `https://q1.qlogo.cn/g?b=qq&nk=${targetId}&s=640`
}

/**
 * 自动撤回消息
 */
export async function autoRecall(session: any, message: string | number, delay: number = 10000): Promise<any> {
  if (!message) return null
  try {
    const msg = typeof message === 'string' ? await session.send(message) : message
    setTimeout(async () => {
      await session.bot?.deleteMessage(session.channelId, msg.toString())
    }, delay)
    return null
  } catch (error) {
    logger.debug(`消息处理失败：${error}`)
    return null
  }
}

/**
 * 通用API请求函数
 */
async function apiRequest<T = any>(url: string, options: {
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
      logger.warn(`API请求失败: ${url} - ${errorMessage}`)
      return null
    }
    return response.data as T
  } catch (e) {
    logger.error(`API请求异常: ${url} - ${e.message}`)
    return null
  }
}

/**
 * 通用范围验证函数
 */
function validateRange(value: number, min: number, max: number, type: string, unit: string): string | null {
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
async function processArgs(session: any, args: h[], templateInfo?: MemeInfo) {
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
            imageInfos.push({ userId: parseTarget(v) })
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
          imageInfos.push({ userId: parseTarget(v) })
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
async function processTemplateParameters(session: any, key: string, args: h[], apiUrl: string) {
  let templateInfo = memeCache.find(t => t.id === key)
  if (!templateInfo) {
    templateInfo = await apiRequest(`${apiUrl}/memes/${key}/info`)
    if (!templateInfo) {
      return autoRecall(session, `获取模板信息失败: ${key}`)
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
  const { imageInfos, texts, options } = await processArgs(session, hArgs, templateInfo)
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
  const imagesError = validateRange(processedImageInfos.length, minImages, maxImages, "图片", "张")
  if (imagesError) return autoRecall(session, imagesError)
  const textsError = validateRange(processedTexts.length, minTexts, maxTexts, "文本", "条")
  if (textsError) return autoRecall(session, textsError)
  // 处理图片和用户信息
  const images: Blob[] = []
  const userInfos: any[] = []
  for (const info of processedImageInfos) {
    let imageUrl: string
    let userInfo = {}
    if ('src' in info) {
      imageUrl = info.src
    } else if ('userId' in info) {
      imageUrl = await getUserAvatar(session, info.userId)
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
      logger.error(`获取图片失败: ${imageUrl} - ${e.message}`)
      return autoRecall(session, `获取图片失败: ${imageUrl}`)
    }
  }
  return { templateInfo, images, texts: processedTexts, userInfos, templateOptions: options }
}

/**
 * 获取模板详情
 */
async function getTemplateDetails(template: MemeInfo) {
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
 * 插件主函数
 */
export function apply(ctx: Context, config: Config) {
  const apiUrl = !config.genUrl ? '' : config.genUrl.trim().replace(/\/+$/, '')
  const memeMaker = new MemeMaker(ctx)
  // 初始化缓存
  async function initCache() {
    if (!apiUrl) return
    memeCache = await loadCache(ctx)
    if (memeCache.length > 0) {
      logger.info(`已加载缓存文件：${memeCache.length}项`)
    } else {
      await refreshCache(ctx, apiUrl)
    }
  }
  initCache()

  const meme = ctx.command('memes [key:string] [...texts:text]', '制作表情包')
    .usage('输入类型并补充对应参数来生成对应表情\n使用"-xx"提供参数，"@用户"提供用户头像\n请使用"."触发子指令，如"memes.list"')
    .example('memes ba_say -character=1 -position=right 你好 - 生成带参数的"心奈"说"你好"的表情')
    .example('memes eat @用户 - 使用指定用户头像生成"吃"表情')
    .action(async ({ session }, key, ...args) => {
      if (!key) {
        return autoRecall(session, '请提供模板ID和文本参数')
      }
      try {
        // 处理模板参数
        const hArgs = args.map(arg => h('text', { content: arg }))
        const result = await processTemplateParameters(session, key, hArgs, apiUrl)
        if (!result) return
        const { images, texts, userInfos, templateOptions } = result
        logger.debug(`正在生成表情: ${key}, 文本数量: ${texts.length}, 图片数量: ${images.length}`)
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
        const imageBuffer = await apiRequest<Buffer>(`${apiUrl}/memes/${key}/`, {
          method: 'post',
          formData,
          responseType: 'arraybuffer',
          timeout: 10000
        })
        if (!imageBuffer) {
          logger.error(`生成表情失败: ${key} - API返回空结果`)
          return autoRecall(session, `生成表情失败: ${key}`)
        }
        // 返回图片
        const base64 = Buffer.from(imageBuffer).toString('base64')
        return h('image', { url: `data:image/png;base64,${base64}` })
      } catch (e) {
        logger.error(`生成表情出错: ${e.message}`)
        return autoRecall(session, `生成表情出错: ${e.message}`)
      }
    })
  meme.subcommand('.list [page:string]', '列出可用模板列表')
    .usage('输入页码查看列表或使用"all"查看所有模板')
    .example('memes.list - 查看第一页模板列表')
    .example('memes.list all - 查看所有模板列表')
    .action(async ({ session }, page) => {
      try {
        let keys: string[]
        if (memeCache.length > 0) {
          keys = memeCache.map(t => t.id)
        } else {
          const apiKeys = await apiRequest<string[]>(`${apiUrl}/memes/keys`)
          if (!apiKeys) {
            return autoRecall(session, `获取模板列表失败`)
          }
          keys = apiKeys
        }
        // 分页处理
        const ITEMS_PER_PAGE = 10
        const showAll = page === 'all'
        const pageNum = typeof page === 'string' ? (parseInt(page) || 1) : (page || 1)
        const totalPages = Math.ceil(keys.length / ITEMS_PER_PAGE)
        const validPage = Math.max(1, Math.min(pageNum, totalPages))
        const pageKeys = showAll ? keys : keys.slice((validPage - 1) * ITEMS_PER_PAGE, validPage * ITEMS_PER_PAGE)
        // 获取当前页模板详情
        const templates = await Promise.all(pageKeys.map(async (key) => {
          const cachedTemplate = memeCache.find(t => t.id === key)
          if (cachedTemplate) {
            return getTemplateDetails(cachedTemplate)
          } else {
            try {
              const info = await apiRequest(`${apiUrl}/memes/${key}/info`)
              if (!info) return { id: key, keywords: [], imgReq: '', textReq: '', tags: [] }
              return getTemplateDetails({
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
        const header = showAll
          ? `表情模板列表（共${keys.length}项）\n`
          : totalPages > 1
            ? `表情模板列表（${validPage}/${totalPages}页）\n`
            : "表情模板列表\n"
        const result = header + templates.map(t => {
          let line = `${t.id}`
          if (t.keywords?.length > 0) {
            line += `|${t.keywords.join(',')}`
          }
          // 显示参数需求和标签
          if (t.imgReq || t.textReq) {
            const reqParts = []
            if (t.imgReq) reqParts.push(t.imgReq)
            if (t.textReq) reqParts.push(t.textReq)
            if (reqParts.length > 0) {
              line += ` [${reqParts.join('/')}]`
            }
          }
          if (t.tags?.length > 0) {
            line += ` #${t.tags.join(' #')}`
          }
          return line
        }).join('\n')
        return result
      } catch (err) {
        logger.error(`列出模板失败: ${err.message}`)
        return autoRecall(session, `获取失败: ${err.message}`)
      }
    })
  meme.subcommand('.info [key:string]', '获取模板详细信息')
    .usage('查看指定表情模板的详细信息，可查询内置参数')
    .example('memes.info ba_say - 查看"ba_say"模板的详细信息和参数')
    .action(async ({ session }, key) => {
      if (!key) {
        return autoRecall(session, '请提供模板ID')
      }
      try {
        // 获取模板信息
        let info
        const cachedTemplate = memeCache.find(t => t.id === key)
        if (cachedTemplate) {
          info = cachedTemplate
        } else {
          info = await apiRequest(`${apiUrl}/memes/${key}/info`)
          if (!info) {
            return autoRecall(session, `获取模板信息失败: ${key}`)
          }
        }
        const pt = info.params_type || {}
        const keywords = Array.isArray(info.keywords) ? info.keywords : [info.keywords].filter(Boolean)
        const lines = [`模板"${key}"详细信息:`]
        // 基本信息
        if (keywords.length) lines.push(`关键词: ${keywords.join(', ')}`)
        if (info.tags?.length) lines.push(`标签: ${info.tags.join(', ')}`)
        // 参数需求
        lines.push('需要参数:')
        lines.push(`- 图片: ${pt.min_images || 0}${pt.max_images !== pt.min_images ? `-${pt.max_images}` : ''}张`)
        lines.push(`- 文本: ${pt.min_texts || 0}${pt.max_texts !== pt.min_texts ? `-${pt.max_texts}` : ''}条`)
        if (pt.default_texts?.length) lines.push(`- 默认文本: ${pt.default_texts.join(', ')}`)
        // 其他参数
        if (pt.args_type?.args_model?.properties) {
          lines.push('其他参数:')
          const properties = pt.args_type.args_model.properties
          const definitions = pt.args_type.args_model.$defs || {}
          // 处理顶层属性
          for (const key in properties) {
            if (key === 'user_infos') continue
            const prop = properties[key]
            let propDesc = `- ${key}`
            // 添加类型信息
            if (prop.type) {
              let typeStr = prop.type
              if (prop.type === 'array' && prop.items?.$ref) {
                const refTypeName = prop.items.$ref.replace('#/$defs/', '').split('/')[0]
                typeStr = `${prop.type}<${refTypeName}>`
              }
              propDesc += ` (${typeStr})`
            }
            // 添加默认值和描述
            if (prop.default !== undefined) propDesc += ` 默认值: ${JSON.stringify(prop.default)}`
            if (prop.description) propDesc += ` - ${prop.description}`
            if (prop.enum?.length) propDesc += ` [可选值: ${prop.enum.join(', ')}]`

            lines.push(propDesc)
          }
          // 展示类型定义
          if (Object.keys(definitions).length > 0) {
            lines.push('类型定义:')
            for (const typeName in definitions) {
              lines.push(`- ${typeName}:`)
              const typeDef = definitions[typeName]
              if (typeDef.properties) {
                for (const propName in typeDef.properties) {
                  const prop = typeDef.properties[propName]
                  let propDesc = `  • ${propName}`

                  if (prop.type) propDesc += ` (${prop.type})`
                  if (prop.default !== undefined) propDesc += ` 默认值: ${JSON.stringify(prop.default)}`
                  if (prop.description) propDesc += ` - ${prop.description}`
                  if (prop.enum?.length) propDesc += ` [可选值: ${prop.enum.join(', ')}]`

                  lines.push(propDesc)
                }
              }
            }
          }
        }
        // 命令行参数
        if (pt.args_type?.parser_options?.length) {
          lines.push('命令行参数:')
          pt.args_type.parser_options.forEach(opt => {
            const names = opt.names.join(', ')
            const argInfo = opt.args?.length ?
              opt.args.map(arg => {
                let argDesc = arg.name
                if (arg.value) argDesc += `:${arg.value}`
                if (arg.default !== null && arg.default !== undefined) argDesc += `=${arg.default}`
                return argDesc
              }).join(' ') : ''
            lines.push(`- ${names} ${argInfo}${opt.help_text ? ` - ${opt.help_text}` : ''}`)
          })
        }
        // 参数示例和快捷指令
        if (pt.args_type?.args_examples?.length) {
          lines.push('参数示例:')
          pt.args_type.args_examples.forEach((example, i) => {
            lines.push(`- 示例${i+1}: ${JSON.stringify(example)}`)
          })
        }
        if (info.shortcuts?.length) {
          lines.push('快捷指令:')
          info.shortcuts.forEach(shortcut => {
            lines.push(`- ${shortcut.humanized || shortcut.key}${shortcut.args?.length ? ` (参数: ${shortcut.args.join(' ')})` : ''}`)
          })
        }
        // 时间信息
        if (info.date_created || info.date_modified) {
          lines.push(`创建时间: ${info.date_created}\n修改时间: ${info.date_modified}`)
        }
        return lines.join('\n')
      } catch (err) {
        logger.error(`获取模板信息失败: ${key} - ${err.message}`)
        return autoRecall(session, `获取模板信息失败: ${err.message}`)
      }
    })
  meme.subcommand('.search <keyword:string>', '搜索表情模板')
    .usage('根据关键词搜索表情模板')
    .example('memes.search 吃 - 搜索包含"吃"关键词的表情模板')
    .action(async ({ session }, keyword) => {
      if (!keyword) {
        return autoRecall(session, '请提供搜索关键词')
      }
      try {
        if (memeCache.length === 0) {
          await refreshCache(ctx, apiUrl)
        }
        const results = memeCache.filter(template =>
          template.keywords.some(k => k.includes(keyword)) ||
          template.tags.some(t => t.includes(keyword)) ||
          template.id.includes(keyword)
        )
        if (results.length === 0) {
          return `未找到表情模板"${keyword}"`
        }
        const resultLines = results.map(t => {
          let line = `${t.id}`
          if (t.keywords?.length > 0) {
            line += `|${t.keywords.join(',')}`
          }
          if (t.tags?.length > 0) {
            line += ` #${t.tags.join(' #')}`
          }
          return line
        })
        return `搜索结果（共${results.length}项）:\n` + resultLines.join('\n')
      } catch (err) {
        logger.error(`搜索模板失败: ${keyword} - ${err.message}`)
        return autoRecall(session, `搜索失败: ${err.message}`)
      }
    })
  meme.subcommand('.refresh', '刷新表情模板缓存', { authority: 3 })
    .usage('手动刷新表情模板缓存数据')
    .action(async ({ session }) => {
      try {
        const result = await refreshCache(ctx, apiUrl)
        return `已刷新缓存文件：${result.length}项`
      } catch (err) {
        logger.error(`刷新缓存失败: ${err.message}`)
        return autoRecall(session, `刷新缓存失败：${err.message}`)
      }
    })

  // 注册图片生成相关命令
  memeMaker.registerCommands(meme)
  // 初始化并注册外部API命令
  if (config.loadApi) {
    const externalApi = new MemeAPI(ctx, logger)
    externalApi.registerCommands(meme)
  }
}