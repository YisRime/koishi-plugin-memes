import { Context, h, Session, Command, Logger } from 'koishi'

/**
 * @interface ParserFlags
 * @description 命令行解析标志，用于定义如何解析额外参数。
 */
export interface ParserFlags {
  short?: boolean
  long?: boolean
  short_aliases?: string[]
  long_aliases?: string[]
}

/**
 * @interface MemeOption
 * @description 定义一个 meme 模板所需的额外参数（除图片和文本外）。
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
 * @interface MemeShortcut
 * @description 定义 meme 模板的快捷指令。
 */
export interface MemeShortcut {
  pattern: string
  humanized?: string | null
  names: string[]
  texts: string[]
  options: Record<string, any>
}

/**
 * @interface MemeInfo
 * @description 插件内部统一的 meme 模板信息结构。
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
 * @function getAvatar
 * @description 获取用户的头像 URL。
 * @param {Session} session - 当前会话对象。
 * @param {string} [userId] - 目标用户的 ID。如果未提供，则默认为当前会话的用户。
 * @returns {Promise<string>} 解析为头像 URL 的 Promise。如果 API 调用失败，则回退到 QQ 的通用头像链接。
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
 * @function parseInput
 * @description 解析 Koishi 的元素（h-element）数组，从中提取图片、文本和命令行风格的参数。
 * @param {h[]} input - 从命令中获取的 h() 元素数组。
 * @param {Session} session - 当前会话对象，用于获取被 at 用户的头像。
 * @returns {Promise<{ imgs: string[], texts: string[], args: Record<string, any> }>} 包含图片URL、文本和参数对象的 Promise。
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
 * @class MemeProvider
 * @description 封装了所有与 MemeGenerator (后端) 的 API 交互逻辑。
 */
export class MemeProvider {
  /**
   * @property {boolean} isRsApi
   * @description 标记检测到的后端是否为 rs-api。不同的后端 API 结构不同。
   */
  public isRsApi: boolean = false
  private cache: MemeInfo[] = []
  private log: Logger

  /**
   * @constructor
   * @description MemeProvider 的构造函数。
   * @param {Context} ctx - Koishi 的上下文对象。
   * @param {string} url - 后端 API 的地址。
   */
  constructor(private ctx: Context, private url: string) {
    this.log = ctx.logger('memes')
  }

  /**
   * @method start
   * @description 初始化服务，检测后端版本并填充缓存。
   * @returns {Promise<{ isRsApi: boolean, count: number, version: string }>} 成功时返回包含后端信息和模板数量的对象。
   * @throws {Error} 当 API 连接或初始化失败时抛出错误。
   */
  async start(): Promise<{ isRsApi: boolean, count: number, version: string }> {
    const versionUrl = `${this.url}/meme/version`
    try {
      const versionRaw = await this.ctx.http.get<string>(versionUrl, { responseType: 'text' })
      const version = versionRaw.replace(/"/g, '')
      this.isRsApi = !version.startsWith('0.1.')
      const count = await this.fetch()
      return { isRsApi: this.isRsApi, count, version }
    } catch (error) {
      throw new Error(`API 连接或初始化失败: ${error.message}`)
    }
  }

  /**
   * @method fetch
   * @description 从 API 重新获取所有 meme 模板并刷新内部缓存。
   * @returns {Promise<number>} 返回加载到的模板数量。
   */
  async fetch(): Promise<number> {
    try {
      this.cache = this.isRsApi ? await this.fetchRs() : await this.fetchFast()
      return this.cache.length
    } catch (e) {
      throw new Error(`刷新模板缓存失败: ${e.message}`)
    }
  }

  /**
   * @method getList
   * @description 获取缓存的 meme 模板列表。
   * @returns {Promise<MemeInfo[]>} 模板信息数组。
   */
  getList(): Promise<MemeInfo[]> {
    return Promise.resolve(this.cache)
  }

  /**
   * @method getInfo
   * @description 根据 key 查找单个 meme 模板。
   * @param {string} key - 模板的 key 或关键词。
   * @param {boolean} [fuzzy=true] - 是否进行模糊搜索。若为 false，则进行精确匹配。
   * @returns {Promise<MemeInfo | null>} 解析为 MemeInfo 或 null 的 Promise。
   */
  async getInfo(key: string, fuzzy = true): Promise<MemeInfo | null> {
    if (!fuzzy) {
      return this.cache.find(t => t.key === key || t.keywords.includes(key)) || null
    }
    const results = await this.find(key)
    return results[0] || null
  }

  /**
   * @method find
   * @description 根据关键词搜索 meme 模板，并按匹配优先级排序。
   * @param {string} query - 要搜索的关键词。
   * @returns {Promise<MemeInfo[]>} 解析为排序后的 MemeInfo 结果数组的 Promise。
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
   * @method getPreview
   * @description 获取 meme 模板的预览图。
   * @param {string} key - 模板的 key。
   * @returns {Promise<Buffer | string>} 解析为图片 Buffer 或错误信息字符串的 Promise。
   */
  async getPreview(key: string): Promise<Buffer | string> {
    try {
      let previewUrl: string
      if (this.isRsApi) {
        const { image_id } = await this.ctx.http.get<{ image_id: string }>(`${this.url}/memes/${key}/preview`);
        previewUrl = `${this.url}/image/${image_id}`
      } else {
        previewUrl = `${this.url}/memes/${key}/preview`
      }
      const resp = await this.ctx.http.get<ArrayBuffer>(previewUrl, { responseType: 'arraybuffer' })
      return Buffer.from(resp)
    } catch (e) {
      this.log.warn('获取预览图失败: %s', e.message)
      return '获取预览图失败。'
    }
  }

  /**
   * @method create
   * @description 根据给定参数生成 meme。
   * @param {string} key - 要使用的模板 key。
   * @param {h[]} input - 包含图片、文本和参数的 Koishi 元素数组。
   * @param {Session} session - 当前会话对象。
   * @returns {Promise<h | string>} 解析为一个 h 图像元素或错误字符串的 Promise。
   */
  async create(key: string, input: h[], session: Session): Promise<h | string> {
    const item = await this.getInfo(key, false)
    if (!item) return `模板不存在: ${key}`

    let { imgs, texts, args } = await parseInput(input, session)

    if (this.isRsApi && imgs.length < item.minImages && item.minImages > 0) {
      imgs.unshift(await getAvatar(session))
    }

    if (imgs.length < item.minImages || imgs.length > item.maxImages) {
      return `图片数量不符, 需要 ${item.minImages}-${item.maxImages} 张, 提供了 ${imgs.length} 张。`
    }
    if (texts.length < item.minTexts || texts.length > item.maxTexts) {
      return `文本数量不符, 需要 ${item.minTexts}-${item.maxTexts} 条, 提供了 ${texts.length} 段。`
    }

    try {
      return this.isRsApi
        ? await this.createRs(key, imgs, texts, args)
        : await this.createFast(key, imgs, texts, args)
    } catch (e) {
      this.log.warn('Meme 生成失败', e)
      return `制作失败: ${e.message}`
    }
  }

  private async fetchRs(): Promise<MemeInfo[]> {
    const data = await this.ctx.http.get<any[]>(`${this.url}/meme/infos`);
    return data.map(info => this.normRs(info)).filter(Boolean) as MemeInfo[];
  }

  private normRs(data: any): MemeInfo | null {
    if (!data || !data.params) return null
    return {
      key: data.key, keywords: data.keywords || [], minImages: data.params.min_images, maxImages: data.params.max_images,
      minTexts: data.params.min_texts, maxTexts: data.params.max_texts, defaultTexts: data.params.default_texts || [],
      args: (data.params.options || []).map(opt => ({ ...opt })),
      tags: data.tags || [], shortcuts: data.shortcuts || [], date_created: data.date_created, date_modified: data.date_modified,
    }
  }

  private async upload(buf: Buffer): Promise<string> {
    const payload = { type: 'data', data: buf.toString('base64') };
    const { image_id } = await this.ctx.http.post<{ image_id: string }>(`${this.url}/image/upload`, payload);
    return image_id;
  }

  private async createRs(key: string, imgs: string[], texts: string[], args: Record<string, any>): Promise<h> {
    const imgBuffers = await Promise.all(imgs.map(url => this.ctx.http.get<ArrayBuffer>(url, { responseType: 'arraybuffer' })));
    const imgIds = await Promise.all(imgBuffers.map(buf => this.upload(Buffer.from(buf))));
    const payload = { images: imgIds.map(id => ({ id })), texts, options: args };
    const res = await this.ctx.http.post<{ image_id: string }>(`${this.url}/memes/${key}`, payload, { timeout: 30000 });
    const finalImg = await this.ctx.http.get<ArrayBuffer>(`${this.url}/image/${res.image_id}`, { responseType: 'arraybuffer' });
    return h.image(Buffer.from(finalImg), 'image/gif');
  }

  private async fetchFast(): Promise<MemeInfo[]> {
    const keys = await this.ctx.http.get<string[]>(`${this.url}/memes/keys`);
    const results = await Promise.allSettled(keys.map(key => this.fetchFastInfo(key)));
    return results.filter(res => res.status === 'fulfilled' && res.value).map(res => (res as PromiseFulfilledResult<MemeInfo>).value);
  }

  private async fetchFastInfo(key: string): Promise<MemeInfo | null> {
    const maxRetries = 10
    for (let i = 0; i < maxRetries; i++) {
      try {
        const data = await this.ctx.http.get<any>(`${this.url}/memes/${key}/info`, { timeout: 10000 });
        return this.normFast(data);
      } catch (error) {
        if (i < maxRetries - 1) {
          this.log.warn(`获取模板 '${key}' 信息失败 (第 ${i + 1} 次), 60秒后重试...`, error.message);
          await new Promise(resolve => setTimeout(resolve, 60000));
        } else {
          this.log.error(`获取模板 '${key}' 信息失败, 已达最大重试次数。`, error.message);
          return null;
        }
      }
    }
    return null;
  }

  private normFast(data: any): MemeInfo | null {
    const params = data.params_type;
    if (!data || !params) return null;
    const args: MemeOption[] = [];
    if (params.args_type?.args_model?.properties) {
      for (const [key, prop] of Object.entries(params.args_type.args_model.properties as Record<string, any>)) {
        if (key === 'user_infos') continue;
        args.push({ name: key, type: prop.type, default: prop.default, description: prop.description, choices: prop.enum });
      }
    }
    return {
      key: data.key, keywords: data.keywords || data.aliases || [], minImages: params.min_images, maxImages: params.max_images,
      minTexts: params.min_texts, maxTexts: params.max_texts, defaultTexts: params.default_texts || [], args: args,
      tags: data.tags || [], shortcuts: (data.shortcuts || []).map(sc => ({ pattern: sc.key, humanized: sc.humanized, names: [], texts: [], options: { _raw_args: sc.args } })),
      date_created: data.date_created, date_modified: data.date_modified,
    };
  }

  private async createFast(key: string, imgs: string[], texts: string[], args: Record<string, any>): Promise<h> {
    const form = new FormData();
    texts.forEach(t => form.append('texts', t));
    await Promise.all(imgs.map(async (url) => {
      const resp = await this.ctx.http.get(url, { responseType: 'arraybuffer' });
      form.append('images', new Blob([resp]));
    }));
    if (Object.keys(args).length) {
      form.append('args', JSON.stringify(args));
    }
    const result = await this.ctx.http.post<ArrayBuffer>(`${this.url}/memes/${key}/`, form, { responseType: 'arraybuffer', timeout: 30000 });
    return h.image(Buffer.from(result), 'image/gif');
  }

  /**
   * @method createToolCmds
   * @description 注册 rs-api 专属的图片处理工具子命令。
   * @param {Command} cmd - 要挂载子命令的 `meme` 主命令。
   */
  public createToolCmds(cmd: Command): void {
    const toolCmd = cmd.subcommand('.tool <image:img>', '图片处理工具')
      .option('hflip', '- 水平翻转图片')
      .option('vflip', '- 垂直翻转图片')
      .option('grayscale', '- 灰度化图片')
      .option('invert', '- 反色图片')
      .option('reverse', '- 倒放 GIF')

    toolCmd.action(async ({ options }, img) => {
      if (!img?.attrs.src) return '请提供一张图片。';

      const endpointMap: Record<string, string> = {
        hflip: 'flip_horizontal',
        vflip: 'flip_vertical',
        grayscale: 'grayscale',
        invert: 'invert',
        reverse: 'gif_reverse',
      }

      const activeOptions = Object.keys(endpointMap).filter(key => options[key]);

      if (activeOptions.length > 1) return '一次只能使用一个处理选项。';
      if (activeOptions.length === 0) return '请指定一个处理选项。';

      const endpoint = endpointMap[activeOptions[0]];

      try {
        const buf = await this.ctx.http.get(img.attrs.src, { responseType: 'arraybuffer' });
        const imgId = await this.upload(Buffer.from(buf));
        const res = await this.ctx.http.post<{ image_id: string }>(`${this.url}/tools/image_operations/${endpoint}`, { image_id: imgId });
        const finalBuf = await this.ctx.http.get(`${this.url}/image/${res.image_id}`, { responseType: 'arraybuffer' });
        return h.image(finalBuf, 'image/png');
      } catch (e) {
        this.log.warn('图片处理失败', e);
        return `处理失败: ${e.message}`;
      }
    });
  }
}
