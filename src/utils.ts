import { h, Logger } from 'koishi'
import fs from 'fs'

/**
 * 解析目标用户ID
 * @param arg - 包含用户ID信息的字符串，可能是@提及、纯数字ID等
 * @returns 解析出的用户ID，如果无法解析则返回原始输入或空字符串
 */
export function parseTarget(arg: string): string {
  if (!arg) return ''
  try {
    const atElement = h.select(h.parse(arg), 'at')[0]
    if (atElement?.attrs?.id) return atElement.attrs.id
  } catch {}
  const match = arg.match(/@(\d+)/)
  if (match) return match[1]
  const userId = arg.trim()
  if (/^\d{5,10}$/.test(userId)) return userId
  return arg
}

/**
 * 获取用户头像URL
 * @param session - 会话对象，包含用户信息
 * @param userId - 可选，要获取头像的用户ID，不提供则使用会话中的用户ID
 * @returns 用户头像的URL地址
 * @async
 */
export async function getUserAvatar(session: any, userId?: string): Promise<string> {
  const targetId = userId || session.userId
  return (targetId === session.userId && session.user?.avatar)
    ? session.user.avatar
    : `https://q1.qlogo.cn/g?b=qq&nk=${targetId}&s=640`
}

/**
 * 发送消息并在指定时间后自动撤回
 * @param session - 会话对象，用于发送和撤回消息
 * @param message - 要发送的消息内容或消息ID
 * @param delay - 可选，撤回消息前等待的时间(毫秒)，默认为10000ms
 * @returns Promise<any> - 操作结果，通常为null
 * @async
 */
export async function autoRecall(session: any, message: string | number, delay = 10000): Promise<any> {
  if (!message) return null
  try {
    const msg = typeof message === 'string' ? await session.send(message) : message
    setTimeout(() => session.bot?.deleteMessage(session.channelId, msg.toString()).catch(() => {}), delay)
    return null
  } catch {
    return null
  }
}

/**
 * 读取JSON文件并解析内容
 * @param filePath - JSON文件的完整路径
 * @param logger - 可选，用于记录操作日志的Logger实例
 * @returns 解析后的JSON数据对象，读取失败时返回null
 * @template T - 文件内容的类型
 */
export function readJsonFile<T>(filePath: string, logger?: Logger): T | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return data
  } catch (err) {
    logger.error(`读取文件失败：${filePath} - ${err.message}`)
    return null
  }
}

/**
 * 将数据写入JSON文件
 * @param filePath - 要写入的JSON文件路径
 * @param data - 要保存的数据对象
 * @param logger - 可选，用于记录操作日志的Logger实例
 * @returns 写入成功返回true，失败返回false
 */
export function writeJsonFile(filePath: string, data: any, logger?: Logger): boolean {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return true
  } catch (err) {
    logger.error(`写入文件失败：${filePath} - ${err.message}`)
    return false
  }
}

/**
 * 加载配置文件，如果不存在则创建默认配置
 * @param filePath - 配置文件的路径
 * @param defaultConfig - 默认配置对象
 * @param logger - 可选，用于记录操作日志的Logger实例
 * @returns 加载的配置对象或默认配置对象
 * @template T - 配置数据的类型
 */
export function loadOrCreateConfig<T>(filePath: string, defaultConfig: T, logger?: Logger): T {
  const data = readJsonFile<T>(filePath, logger)
  return data !== null ? data : (writeJsonFile(filePath, defaultConfig, logger) ? defaultConfig : defaultConfig)
}

/**
 * 发送API请求并处理响应
 * @param url - 请求的URL地址
 * @param options - 请求选项配置对象
 * @param options.method - 可选，请求方法，默认为'get'
 * @param options.data - 可选，请求体数据，用于POST请求
 * @param options.formData - 可选，表单数据
 * @param options.responseType - 可选，响应类型，默认为'json'
 * @param options.timeout - 可选，请求超时时间(毫秒)，默认为8000ms
 * @param logger - 可选，用于记录操作日志的Logger实例
 * @returns 请求成功返回响应数据，失败返回null
 * @template T - 返回数据的类型，默认为any
 * @async
 */
export async function apiRequest<T = any>(url: string, options: {
  method?: 'get' | 'post',
  data?: any,
  formData?: FormData,
  responseType?: 'json' | 'arraybuffer',
  timeout?: number
} = {}, logger?: Logger): Promise<T | null> {
  const { method = 'get', data, formData, responseType = 'json', timeout = 8000 } = options
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort('请求超时'), timeout)
    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      signal: controller.signal,
      headers: formData ? { 'Accept': 'image/*,application/json' } :
               data ? { 'Content-Type': 'application/json' } : {},
      body: formData || (data ? JSON.stringify(data) : undefined)
    }
    const response = await fetch(url, fetchOptions)
    clearTimeout(timeoutId)
    if (!response.ok) {
      let errorMessage = `HTTP状态码 ${response.status}`
      try {
        if (responseType === 'arraybuffer') {
          const errText = Buffer.from(await response.arrayBuffer()).toString('utf-8')
          try { errorMessage = JSON.parse(errText)?.error || errorMessage } catch {}
        } else {
          const errJson = await response.json().catch(() => null)
          errorMessage = errJson?.error || errJson?.message || errorMessage
        }
      } catch {}
      logger.warn(`API请求失败: ${url} - ${errorMessage}`)
      return null
    }
    return responseType === 'arraybuffer'
      ? Buffer.from(await response.arrayBuffer()) as unknown as T
      : await response.json() as T
  } catch (e) {
    logger.error(`API请求异常: ${url} - ${e.message}`)
    return null
  }
}

/**
 * 将表情模板列表渲染为图片
 * @param ctx - 上下文对象，包含puppeteer实例
 * @param title - 列表的标题
 * @param templates - 要显示的模板数组
 * @returns 包含渲染图片数据的Buffer对象
 * @async
 */
export async function renderTemplateListAsImage(ctx: any, title: string, templates: any[]): Promise<Buffer> {
  const page = await ctx.puppeteer.page();
  try {
    // 计算布局参数
    const columnCount = Math.min(Math.ceil(templates.length / 50), 6);
    const itemsPerColumn = Math.ceil(templates.length / columnCount);
    const columnWidth = 190;
    const containerWidth = columnWidth * columnCount + (columnCount - 1) * 8 + 24;
    // 将模板分组到各列
    const columns = Array.from({ length: columnCount }, (_, i) =>
      templates.slice(i * itemsPerColumn, Math.min((i + 1) * itemsPerColumn, templates.length))
    );
    // 构建HTML
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { margin: 0; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #2b333e; font-size: 14px; }
        .container { margin: 12px; background: #fff; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.1);
                    padding: 14px; width: ${containerWidth}px; }
        header { text-align: center; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid rgba(0,0,0,0.08); }
        h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px 0; }
        .sub-title { font-size: 13px; color: #5c7080; }
        .columns-wrap { display: flex; gap: 8px; }
        .column { flex: 1; background: #f8f9fa; border-radius: 8px; border: 1px solid rgba(0,0,0,0.04);
                 padding: 6px 4px; width: ${columnWidth}px; }
        .item { display: flex; align-items: center; padding: 3px 6px; border-radius: 4px; margin-bottom: 1px; }
        .item:hover { background: #edf4ff; }
        .icons { position: relative; width: 24px; height: 16px; margin-right: 8px; flex-shrink: 0; }
        .keywords { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; font-size: 14.5px; }
        .kw { color: #2b333e; }
        .kw:not(:last-child):after { content: ","; color: #aaa; margin-right: 2px; }
        .icon { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center;
               position: absolute; top: 0; border-radius: 3px; box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
        .text-icon { background: #3e90ff; left: 0; z-index: 1; }
        .image-icon { background: #38b48b; left: 10px; z-index: 2; }
        .text-icon:only-child, .image-icon:only-child { left: 4px; }
        svg { width: 12px; height: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>${title}</h1>
          <div class="sub-title">共 ${templates.length} 个模板</div>
        </header>
        <div class="columns-wrap">
          ${columns.map(items => `
            <div class="column">
              ${items.map(template => {
                const imgCount = (template.imgReq?.match(/图片(\d+)/)?.[1] || 0) * 1;
                const textCount = (template.textReq?.match(/文本(\d+)/)?.[1] || 0) * 1;
                return `<div class="item">
                  <div class="icons">
                    ${textCount > 0 ? '<span class="icon text-icon"><svg viewBox="0 0 16 16" fill="none" stroke="white" stroke-width="2"><path d="M2 4h12M4 8h8M2 12h12"/></svg></span>' : ''}
                    ${imgCount > 0 ? '<span class="icon image-icon"><svg viewBox="0 0 16 16" fill="none" stroke="white" stroke-width="2"><rect x="2" y="2" width="12" height="12" rx="1"/><circle cx="5.5" cy="5.5" r="1"/><path d="M13 10l-3-3-6 6"/></svg></span>' : ''}
                  </div>
                  <div class="keywords">
                    ${template.keywords.map(k => `<span class="kw">${k}</span>`).join('')}
                  </div>
                </div>`;
              }).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    </body>
    </html>`;
    // 渲染和截图
    await page.setViewport({ width: containerWidth + 24, height: 600, deviceScaleFactor: 1.5 });
    await page.setContent(html);
    await page.waitForFunction(() => document.fonts.ready).catch(() => {});
    // 获取实际尺寸并调整视口
    const { width, height } = await page.evaluate(() => {
      const container = document.querySelector('.container') as HTMLElement;
      return { width: container.offsetWidth + 24, height: container.offsetHeight + 24 };
    });
    await page.setViewport({ width, height, deviceScaleFactor: 1.5 });
    return await page.screenshot({ type: 'png', omitBackground: true });
  } finally {
    await page.close();
  }
}

/**
 * 将单个表情模板的详细信息渲染为图片
 * @param ctx - 上下文对象，包含puppeteer实例
 * @param template - 模板信息对象
 * @param previewImgUrl - 可选，模板预览图的URL或base64数据
 * @returns 包含渲染图片数据的Buffer对象
 * @async
 */
export async function renderTemplateInfoAsImage(ctx: any, template: any, previewImgUrl?: string): Promise<Buffer> {
  const page = await ctx.puppeteer.page();
  try {
    // 准备模板基本信息
    const keywords = Array.isArray(template.keywords) ? template.keywords : [template.keywords].filter(Boolean);
    const title = `${keywords.join(', ')} (${template.id})`;
    const tags = Array.isArray(template.tags) ? template.tags : [];
    const pt = template.params_type || {};
    // 构建各部分信息
    const sections = [
      // 参数需求
      {
        title: '参数需求',
        className: 'requirements',
        itemClass: 'req-item',
        items: [
          `图片: ${pt.min_images || 0}${pt.min_images !== pt.max_images ? `-${pt.max_images || '∞'}` : ''}张`,
          `文本: ${pt.min_texts || 0}${pt.min_texts !== pt.max_texts ? `-${pt.max_texts || '∞'}` : ''}条`,
          ...(pt.default_texts?.length ? [`默认文本: ${pt.default_texts.join(', ')}`] : [])
        ]
      },
      // 其他参数
      {
        title: '其他参数',
        items: Object.entries(pt.args_type?.args_model?.properties || {})
          .filter(([key]) => key !== 'user_infos')
          .map(([key, prop]) => {
            const prop_obj = prop as any;
            let desc = key;
            if (prop_obj.type) {
              let typeStr = prop_obj.type;
              if (prop_obj.type === 'array' && prop_obj.items?.$ref) {
                typeStr = `${prop_obj.type}<${prop_obj.items.$ref.replace('#/$defs/', '').split('/')[0]}>`;
              }
              desc += ` (${typeStr})`;
            }
            if (prop_obj.default !== undefined) desc += ` 默认值: ${JSON.stringify(prop_obj.default)}`;
            if (prop_obj.description) desc += ` - ${prop_obj.description}`;
            if (prop_obj.enum?.length) desc += ` [可选值: ${prop_obj.enum.join(', ')}]`;
            return desc;
          })
      },
      // 命令行参数
      {
        title: '命令行参数',
        items: (pt.args_type?.parser_options || []).map(opt => {
          let desc = `${opt.names.join(', ')}`;
          if (opt.args?.length) {
            desc += ` ${opt.args.map(arg => {
              let argDesc = arg.name;
              if (arg.value) argDesc += `:${arg.value}`;
              if (arg.default != null) argDesc += `=${arg.default}`;
              return argDesc;
            }).join(' ')}`;
          }
          return opt.help_text ? `${desc} - ${opt.help_text}` : desc;
        })
      },
      // 快捷指令
      {
        title: '快捷指令',
        items: (template.shortcuts || []).map(s =>
          `${s.humanized || s.key}${s.args?.length ? ` (参数: ${s.args.join(' ')})` : ''}`)
      }
    ];
    // 时间信息
    const timeInfo = [
      template.date_created && `创建时间: ${template.date_created}`,
      template.date_modified && `修改时间: ${template.date_modified}`
    ].filter(Boolean);
    // 构建HTML
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { margin: 0; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #2b333e; font-size: 14px; }
        .container { margin: 12px; background: #fff; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.1);
                     padding: 16px; max-width: 800px; }
        header { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid rgba(0,0,0,0.08); }
        h1 { font-size: 22px; font-weight: 600; margin: 0 0 6px 0; }
        .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .tag { background: #f0f5ff; color: #3e90ff; border-radius: 4px; padding: 2px 8px; font-size: 13px; }
        .preview { margin: 16px 0; text-align: center; }
        .preview img { max-width: 100%; max-height: 300px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.1); }
        .section { margin-bottom: 16px; }
        .section h2 { font-size: 16px; font-weight: 600; margin: 0 0 8px 0; color: #3e90ff; }
        .item { margin-bottom: 8px; background: #f8f9fa; border-radius: 6px; padding: 8px 12px; }
        .requirements { display: flex; flex-wrap: wrap; gap: 12px; }
        .req-item { background: #f0f7ff; border-left: 3px solid #3e90ff; padding: 6px 10px; border-radius: 0 4px 4px 0; }
        .info-row { color: #666; font-size: 13px; margin-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>${title}</h1>
          ${tags.length ? `<div class="tags">${tags.map(tag => `<span class="tag">${tag}</span>`).join('')}</div>` : ''}
        </header>
        ${previewImgUrl ? `<div class="preview"><img src="${previewImgUrl}" alt="预览图"></div>` : ''}
        ${sections.map(section => section.items.length ? `
          <div class="section">
            <h2>${section.title}</h2>
            <div class="${section.className || 'normal'}">
              ${section.items.map(item => `<div class="${section.itemClass || 'item'}">${item}</div>`).join('')}
            </div>
          </div>
        ` : '').join('')}
        ${timeInfo.length ? `<div class="info-row">${timeInfo.join(' · ')}</div>` : ''}
      </div>
    </body>
    </html>`;
    // 渲染和截图
    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1.5 });
    await page.setContent(html);
    await page.waitForFunction(() => document.fonts.ready).catch(() => {});
    // 获取实际尺寸并调整视口
    const { width, height } = await page.evaluate(() => {
      const container = document.querySelector('.container') as HTMLElement;
      return { width: container.offsetWidth + 24, height: container.offsetHeight + 24 };
    });
    await page.setViewport({ width, height, deviceScaleFactor: 1.5 });
    return await page.screenshot({ type: 'png', omitBackground: true });
  } finally {
    await page.close();
  }
}
