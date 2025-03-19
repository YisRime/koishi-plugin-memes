import { Context, h, Logger } from 'koishi'
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { EmoticonConfig } from './emoticontype'

export const log = new Logger('memes')

/**
 * 解析目标用户ID (支持@元素、@数字格式或纯数字)
 */
export function parseId(target: string): string | null {
  if (!target) return null
  // 尝试解析at元素
  try {
    const at = h.select(h.parse(target), 'at')[0]
    if (at?.attrs?.id) return at.attrs.id
  } catch {}
  // 尝试匹配@数字格式或纯数字
  const match = target.match(/@(\d+)/)
  const uid = match ? match[1] : (/^\d+$/.test(target.trim()) ? target.trim() : null)
  return uid && /^\d{5,10}$/.test(uid) ? uid : null
}

/**
 * 计算字符串的显示宽度（中文字符计2，其他字符计1）
 */
export function getWidth(str: string): number {
  let w = 0
  for (const c of str) {
    w += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(c) ? 2 : 1
  }
  return w
}

/**
 * 初始化表情包配置
 */
export function loadConfig(ctx: Context, loadExt: boolean, defTypes: EmoticonConfig[]): EmoticonConfig[] {
  const cfgPath = path.resolve(ctx.baseDir, 'data', 'memes.json')
  if (!fs.existsSync(cfgPath)) {
    try {
      fs.writeFileSync(cfgPath, JSON.stringify(defTypes, null, 2), 'utf-8')
      log.info(`已创建表情包配置：${cfgPath}`)
      return defTypes
    } catch (e) {
      log.error(`创建配置文件失败：${e.message}`)
      return defTypes
    }
  }

  if (loadExt) {
    try {
      const content = fs.readFileSync(cfgPath, 'utf-8')
      const extTypes = JSON.parse(content)
      log.info(`已加载外部配置：${cfgPath}（共${extTypes.length}项）`)
      return extTypes
    } catch (e) {
      log.error(`加载外部配置失败：${e.message}`)
      return defTypes
    }
  }
  return defTypes
}

/**
 * 显示表情包类型菜单，支持分页
 */
export function showMenu(types: EmoticonConfig[], page: number | string = 1): string {
  const LINES = 10
  let all = page === 'all'
  if (typeof page === 'string') page = parseInt(page) || 1
  // 获取所有表情类型的描述
  const descs = types.map(t => t.description.split('|')[0].trim())
  // 格式化菜单行
  const formatLines = () => {
    const lines = []
    let line = ''
    let width = 0
    const MAX_W = 36, SEP = ' ', SEP_W = 1

    for (const d of descs) {
      const dw = getWidth(d)
      if (width + dw + SEP_W > MAX_W && width > 0) {
        lines.push(line)
        line = d
        width = dw
      } else if (line.length === 0) {
        line = d
        width = dw
      } else {
        line += SEP + d
        width += SEP_W + dw
      }
    }
    if (line.length > 0) lines.push(line)
    return lines
  }

  const allLines = formatLines()
  const total = Math.ceil(allLines.length / LINES)
  const validPage = Math.max(1, Math.min(page as number, all ? 1 : total))
  const showLines = all ? allLines : allLines.slice((validPage - 1) * LINES, validPage * LINES)

  let menu = ""
  if (all) {
    menu = `表情列表（共${types.length}项）\n`
  } else if (total > 1) {
    menu = `表情列表（第${validPage}/${total}页）\n`
  } else {
    menu = "表情列表\n"
  }
  return menu + showLines.join('\n')
}

/**
 * 选择表情类型
 */
export function chooseType(types: EmoticonConfig[], type: string): number {
  if (!type) return Math.floor(Math.random() * types.length)

  return types.findIndex(t => {
    const descs = t.description.split('|')
    return descs.some(d => d.trim() === type.trim())
  })
}

/**
 * 生成表情包图片
 */
export async function genImg(cfg: EmoticonConfig, arg1: string, arg2: string, session): Promise<string> {
  // 处理参数函数
  const parseArg = (arg: string, def: string) => !arg ? def : (parseId(arg) || arg)
  // 处理参数
  const defArg1 = session.userId
  const defArg2 = '测试文本'
  const pArg1 = parseArg(arg1, defArg1)
  const pArg2 = parseArg(arg2, defArg2)
  // 替换参数占位符
  let url = cfg.apiEndpoint
    .replace(/\${arg1}/g, pArg1)
    .replace(/\${arg2}/g, pArg2)

  try {
    const res = await axios.get(url, {
      timeout: 8000,
      validateStatus: () => true,
      responseType: 'text'
    })
    // 处理JSON响应
    if (res.headers['content-type']?.includes('application/json')) {
      try {
        const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
        return data?.code === 200 ? data.data : url
      } catch {
        return url
      }
    }
    return url
  } catch (err) {
    log.error(`请求失败: ${err.message}`)
    throw new Error(`请求失败: ${err.message}`)
  }
}

export interface MemeTemplate {
  id: string
  name: string
  text_count: number
}

/**
 * 从 MemeGenerator API 获取模板列表
 */
export async function getTpls(apiUrl: string): Promise<MemeTemplate[]> {
  try {
    const res = await axios.get(`${apiUrl}/templates`, { timeout: 8000 })
    return res.data && Array.isArray(res.data) ? res.data : []
  } catch (err) {
    log.error(`获取模板列表失败: ${err.message}`)
    throw new Error(`获取模板列表失败: ${err.message}`)
  }
}

/**
 * 获取单个模板信息
 */
export async function getTplInfo(apiUrl: string, tplId: string): Promise<MemeTemplate | null> {
  try {
    const tpls = await getTpls(apiUrl)
    return tpls.find(t => t.id === tplId) || null
  } catch (err) {
    log.error(`获取模板信息失败: ${err.message}`)
    return null
  }
}

/**
 * 使用 MemeGenerator API 生成表情包
 */
export async function genMeme(apiUrl: string, tplId: string, texts: string[], session): Promise<string> {
  try {
    // 处理可能的图片参数
    const processedTexts = texts.map(text => {
      // 检查是否为图片链接
      if (text && (text.startsWith('http') && /\.(jpg|jpeg|png|gif|webp)$/i.test(text))) {
        return text
      }

      // 尝试解析图片元素
      try {
        const imgElements = h.select(h.parse(text), 'image')
        if (imgElements.length > 0 && imgElements[0].attrs?.url) {
          return imgElements[0].attrs.url
        }
      } catch {}

      return text
    })

    // 获取模板信息
    const tplInfo = await getTplInfo(apiUrl, tplId)
    const finalTexts = [...processedTexts]

    // 如果参数不足且用户有头像，使用用户头像填充
    if (tplInfo && finalTexts.length < tplInfo.text_count && session?.user?.avatar) {
      while (finalTexts.length < tplInfo.text_count) {
        finalTexts.push(session.user.avatar)
      }
    }

    // 如果没有任何参数且用户有头像，添加用户头像作为第一个参数
    if (finalTexts.length === 0 && session?.user?.avatar) {
      finalTexts.push(session.user.avatar)
    }

    const payload = {
      template_id: tplId,
      texts: finalTexts
    }

    const res = await axios.post(`${apiUrl}/generate`,
      payload,
      { timeout: 8000, responseType: 'json' }
    )

    if (res.data && res.data.url) {
      return res.data.url
    } else {
      throw new Error('API 返回的数据格式不正确')
    }
  } catch (err) {
    log.error(`生成表情包失败: ${err.message}`)
    throw new Error(`生成表情包失败: ${err.message}`)
  }
}
