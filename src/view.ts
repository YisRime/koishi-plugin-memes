import { Context } from 'koishi'
import { MemeInfo } from './provider'
import {} from 'koishi-plugin-puppeteer'

const listImageCSS = `body{margin:0;font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#2b333e;font-size:14px}.container{margin:12px;background:#fff;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.1);padding:14px}header{text-align:center;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(0,0,0,.08)}h1{font-size:20px;font-weight:600;margin:0 0 4px 0}.sub-title{font-size:13px;color:#5c7080}.columns-wrap{display:flex;gap:8px}.column{flex:1;background:#f8f9fa;border-radius:8px;border:1px solid rgba(0,0,0,.04);padding:6px 4px}.item{display:flex;align-items:center;padding:3px 6px;border-radius:4px;margin-bottom:1px}.item:hover{background:#edf4ff}.icons{position:relative;width:24px;height:16px;margin-right:8px;flex-shrink:0}.keywords{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500;font-size:14.5px}.kw{color:#2b333e}.kw:not(:last-child):after{content:",";color:#aaa;margin-right:2px}.icon{width:16px;height:16px;display:flex;align-items:center;justify-content:center;position:absolute;top:0;border-radius:3px;box-shadow:0 1px 2px rgba(0,0,0,.15)}.text-icon{background:#3e90ff;left:0;z-index:1}.image-icon{background:#38b48b;left:10px;z-index:2}.text-icon:only-child,.image-icon:only-child{left:4px}svg{width:12px;height:12px}`
const infoImageCSS = `body{margin:0;font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#2b333e;font-size:14px}.container{margin:12px;background:#fff;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.1);padding:16px;max-width:800px}header{margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid rgba(0,0,0,.08)}h1{font-size:22px;font-weight:600;margin:0 0 6px 0}.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.tag{background:#f0f5ff;color:#3e90ff;border-radius:4px;padding:2px 8px;font-size:13px}.preview{margin:16px 0;text-align:center}.preview img{max-width:100%;max-height:300px;border-radius:8px;border:1px solid rgba(0,0,0,.1)}.section{margin-bottom:16px}.section h2{font-size:16px;font-weight:600;margin:0 0 8px 0;color:#3e90ff}.item{margin-bottom:8px;background:#f8f9fa;border-radius:6px;padding:8px 12px;line-height:1.6}.item strong{color:#1d63f2}.item code{background:#eef;color:#d63384;padding:1px 4px;border-radius:4px;font-size:13px}.footer{text-align:right;margin-top:12px;font-size:12px;color:#889}`

/**
 * View 类，负责将模板信息格式化为用户友好的文本或图片
 */
export class View {
  constructor(private ctx: Context) {}

  /**
   * 将模板列表格式化为分页的纯文本
   * @param list - 模板信息数组
   * @param page - 当前页码
   * @param perPage - 每页显示的数量
   * @returns 格式化后的文本字符串
   */
  listAsText(list: MemeInfo[], page: number, perPage: number): string {
    const allKeys = list.flatMap(t => t.keywords.length ? t.keywords : [t.key])
    const lines: string[] = []
    let currentLine = ''

    for (const key of allKeys) {
      if (currentLine && (currentLine + ' ' + key).length > 36) {
        lines.push(currentLine)
        currentLine = key
      } else {
        currentLine = currentLine ? `${currentLine} ${key}` : key
      }
    }
    if (currentLine) lines.push(currentLine)

    const total = Math.ceil(lines.length / perPage)
    const validPage = Math.max(1, Math.min(page, total))
    const display = lines.slice((validPage - 1) * perPage, validPage * perPage)
    return `模板列表 (${validPage}/${total} 页, 共 ${list.length} 个)\n${display.join('\n')}`
  }

  /**
   * 将单个模板的详细信息格式化为纯文本
   * @param item - 模板信息对象
   * @returns 格式化后的文本字符串
   */
  infoAsText(item: MemeInfo): string {
    const output: string[] = [`名称: ${item.keywords.join(', ') || item.key} (${item.key})`]
    if (item.tags?.length) output.push(`标签: ${item.tags.join(', ')}`)
    output.push('参数:', `  图片数: ${item.minImages}-${item.maxImages} 张`, `  文本数: ${item.minTexts}-${item.maxTexts} 条`)
    if (item.defaultTexts?.length) output.push(`  默认文本: ${item.defaultTexts.join(', ')}`)
    if (item.args?.length) {
      output.push('额外参数:', ...item.args.map(arg => {
        let desc = `  - ${arg.name} (${arg.type || 'any'})`
        if (arg.default !== undefined) desc += `, 默认: ${JSON.stringify(arg.default)}`
        return desc
      }))
    }
    if (item.shortcuts?.length) output.push('快捷指令:', ...item.shortcuts.map(sc => `  - ${sc.humanized || sc.pattern}`))
    if (item.date_created) output.push(`创建时间: ${new Date(item.date_created).toLocaleString()}`)
    return output.join('\n')
  }

  /**
   * 使用 Puppeteer 将 HTML 渲染为图片
   * @param html - 要渲染的 HTML 字符串
   * @param options - 渲染选项，包括宽度和截图选择器
   * @returns 返回包含 PNG 图片数据的 Buffer
   */
  private async renderPage(html: string, options: { width: number, selector: string }): Promise<Buffer> {
    const page = await this.ctx.puppeteer.page()
    try {
      await page.setViewport({ width: options.width, height: 100, deviceScaleFactor: 1.5 })
      await page.setContent(html, { waitUntil: 'networkidle0' })
      const bounds = await page.evaluate((selector) => {
        const el = document.querySelector(selector) as HTMLElement
        if (!el) return null
        const { width, height } = el.getBoundingClientRect()
        return { width: Math.ceil(width) + 24, height: Math.ceil(height) + 24 }
      }, options.selector)

      if (!bounds) throw new Error('Could not find element to screenshot.')

      await page.setViewport({ ...bounds, deviceScaleFactor: 1.5 })
      return await page.screenshot({ type: 'png', omitBackground: true, clip: { x: 12, y: 12, width: bounds.width - 24, height: bounds.height - 24 } })
    } finally {
      await page.close()
    }
  }

  /**
   * 将模板列表渲染为一张图片
   * @param list - 模板信息数组
   * @returns 返回包含 PNG 图片数据的 Buffer
   */
  async listAsImage(list: MemeInfo[]): Promise<Buffer> {
    const colCount = Math.min(Math.ceil(list.length / 50), 6)
    const perCol = Math.ceil(list.length / colCount)
    const cols = Array.from({ length: colCount }, (_, i) => list.slice(i * perCol, (i + 1) * perCol))
    const renderItem = (item: MemeInfo) => `<div class="item"><div class="icons">${item.minTexts > 0 || item.maxTexts > 0 ? '<span class="icon text-icon"><svg viewBox="0 0 16 16" fill="none" stroke="white" stroke-width="2"><path d="M2 4h12M4 8h8M2 12h12"/></svg></span>' : ''}${item.minImages > 0 || item.maxImages > 0 ? '<span class="icon image-icon"><svg viewBox="0 0 16 16" fill="none" stroke="white" stroke-width="2"><rect x="2" y="2" width="12" height="12" rx="1"/><circle cx="5.5" cy="5.5" r="1"/><path d="M13 10l-3-3-6 6"/></svg></span>' : ''}</div><div class="keywords">${(item.keywords.length ? item.keywords : [item.key]).map(k => `<span class="kw">${k}</span>`).join('')}</div></div>`
    const renderCols = cols.map(items => `<div class="column">${items.map(renderItem).join('')}</div>`).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${listImageCSS}</style></head><body><div class="container"><header><h1>表情模板列表</h1><div class="sub-title">共 ${list.length} 个模板</div></header><div class="columns-wrap">${renderCols}</div></div></body></html>`
    return this.renderPage(html, { width: 1200, selector: '.container' })
  }

  /**
   * 将单个模板的详细信息渲染为一张图片
   * @param item - 模板信息对象
   * @param previewData - (可选) 预览图的 Base64 数据 URI
   * @returns 返回包含 PNG 图片数据的 Buffer
   */
  async infoAsImage(item: MemeInfo, previewData?: string): Promise<Buffer> {
    const sections = [
      { title: '参数需求', items: [`图片: ${item.minImages}-${item.maxImages}张`, `文本: ${item.minTexts}-${item.maxTexts}条`, ...(item.defaultTexts?.length ? [`默认文本: ${item.defaultTexts.join(', ')}`] : [])] },
      { title: '其他参数', items: (item.args || []).map(p => `<strong>${p.name}</strong> (${p.type || 'any'})` + (p.default !== undefined ? `, 默认: <code>${JSON.stringify(p.default)}</code>` : '') + (p.description ? `<br>描述: ${p.description}` : '')) },
      { title: '快捷指令', items: (item.shortcuts || []).map(sc => `• ${sc.humanized || sc.pattern}`) },
    ].filter(s => s.items.some(Boolean))
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${infoImageCSS}</style></head><body><div class="container"><header><h1>${item.keywords.join(', ') || item.key} (${item.key})</h1>${item.tags?.length ? `<div class="tags">${item.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}</div>` : ''}</header>${previewData ? `<div class="preview"><img src="${previewData}" alt="预览图"></div>` : ''}${sections.map(sec => `<div class="section"><h2>${sec.title}</h2><div>${sec.items.map(i => `<div class="item">${i}</div>`).join('')}</div></div>`).join('')}${item.date_created ? `<div class="footer">创建于: ${new Date(item.date_created).toLocaleString()}</div>` : ''}</div></body></html>`
    return this.renderPage(html, { width: 800, selector: '.container' })
  }
}
