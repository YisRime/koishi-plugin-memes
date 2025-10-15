import { Context, h, Session, Command, Logger } from 'koishi'

/**
 * @interface ParserFlags
 * @description 命令行解析标志。
 * @property {boolean} [short] - 是否有短标志。
 * @property {boolean} [long] - 是否有长标志。
 * @property {string[]} [short_aliases] - 短标志别名。
 * @property {string[]} [long_aliases] - 长标志别名。
 */
export interface ParserFlags {
  short?: boolean
  long?: boolean
  short_aliases?: string[]
  long_aliases?: string[]
}

/**
 * @interface MemeOption
 * @description meme 模板参数定义。
 * @property {string} name - 参数名称。
 * @property {string} type - 参数类型。
 * @property {any} [default] - 默认值。
 * @property {string | null} [description] - 参数描述。
 * @property {ParserFlags} [parser_flags] - 命令行解析标志。
 * @property {(string | number)[] | null} [choices] - 可选值列表。
 * @property {number | null} [minimum] - 最小值。
 * @property {number | null} [maximum] - 最大值。
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
 * @description meme 模板快捷方式定义。
 * @property {string} pattern - 匹配模式。
 * @property {string | null} [humanized] - 人性化描述。
 * @property {string[]} names - 名称列表。
 * @property {string[]} texts - 文本内容。
 * @property {Record<string, any>} options - 选项。
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
 * @description meme 模板信息接口。
 * @property {string} key - 模板的唯一标识。
 * @property {string[]} keywords - 触发关键词。
 * @property {number} minImages - 所需的最小图片数。
 * @property {number} maxImages - 所需的最大图片数。
 * @property {number} minTexts - 所需的最小文本数。
 * @property {number} maxTexts - 所需的最大文本数。
 * @property {string[]} defaultTexts - 默认文本。
 * @property {MemeOption[]} args - 额外参数定义。
 * @property {string[]} [tags] - 模板标签。
 * @property {MemeShortcut[]} [shortcuts] - 快捷指令。
 * @property {string} [date_created] - 创建日期。
 * @property {string} [date_modified] - 修改日期。
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
 * 获取用户头像 URL。
 * @param {Session} session - 当前会话对象。
 * @param {string} [userId] - 目标用户的 ID (可选, 默认为当前会话用户)。
 * @returns {Promise<string>} 一个解析为头像 URL 的 Promise。
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
 * 解析 Koishi 的元素数组，提取图片、文本和命令行参数。
 * @param {h[]} input - 要解析的 h() 元素数组。
 * @param {Session} session - 当前会话对象。
 * @returns {Promise<{ imgs: string[], texts: string[], args: Record<string, any> }>} 一个包含图片URL、文本和参数对象的 Promise。
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
 * @description 封装了所有与 meme 生成 API 的交互逻辑。
 */
export class MemeProvider {
  /** @property {boolean} isRsApi - 标记检测到的后端是否为 rs。 */
  public isRsApi: boolean = false
  /** @property {MemeInfo[]} cache - 内部 meme 模板缓存。 */
  private cache: MemeInfo[] = []
  /** @property {Logger} log - 日志记录器实例。 */
  private log: Logger

  /**
   * MemeProvider 的构造函数。
   * @param {Context} ctx - Koishi 的上下文对象。
   * @param {string} url - 后端 API 的地址。
   */
  constructor(private ctx: Context, private url: string) {}

  /**
   * 初始化服务，检测后端版本并填充缓存。
   * @returns {Promise<string | null>} 成功时返回 null，失败时返回错误信息字符串。
   */
  async start(): Promise<string | null> {
    const versionUrl = `${this.url}/meme/version`
    try {
      this.log.info('请求地址: %s', versionUrl)
      const version = await this.ctx.http.get<string>(versionUrl, { responseType: 'text' })
      this.log.info('收到响应: %s', version)

      const cleanVer = version.replace(/"/g, '')
      this.isRsApi = !cleanVer.startsWith('0.1.')

      const fetchError = await this.fetch()
      if (fetchError) return fetchError // 如果 fetch 失败，则传递错误信息

      return null // 初始化成功
    } catch (error) {
      this.log.error('API 连接或版本检查失败。', error)
      return `API 连接失败: ${error.message}。`
    }
  }

  /**
   * 从 API 重新获取所有 meme 模板并刷新内部缓存。
   * @returns {Promise<string | null>} 成功时返回 null，失败时返回错误信息字符串。
   */
  async fetch(): Promise<string | null> {
    this.log.info('正在获取 meme 模板...')
    try {
      this.cache = this.isRsApi
        ? await this.fetchRs()
        : await this.fetchFast()
      this.log.info(`缓存更新成功，共加载了 ${this.cache.length} 个模板。`)
      return null
    } catch (e) {
      this.log.error('刷新缓存失败。', e)
      return `刷新模板缓存失败: ${e.message}`
    }
  }

  /**
   * 获取缓存的 meme 模板列表。
   * @returns {Promise<MemeInfo[]>} 解析为 MemeInfo 对象数组的 Promise。
   */
  getList(): Promise<MemeInfo[]> {
    return Promise.resolve(this.cache)
  }

  /**
   * 根据 key 查找单个 meme 模板。
   * @param {string} key - 模板的 key 或关键词。
   * @param {boolean} [fuzzy=true] - 是否进行模糊搜索。若为 false, 则进行精确匹配。
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
   * 根据关键词搜索 meme 模板。
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
   * 获取 meme 模板的预览图。
   * @param {string} key - 模板的 key。
   * @returns {Promise<Buffer | string>} 解析为图片 Buffer 或错误信息字符串的 Promise。
   */
  async getPreview(key: string): Promise<Buffer | string> {
    let previewUrl: string;
    try {
      if (this.isRsApi) {
        const previewInfoUrl = `${this.url}/memes/${key}/preview`;
        this.log.info('请求地址: %s', previewInfoUrl);
        const { image_id } = await this.ctx.http.get<{ image_id: string }>(previewInfoUrl);
        this.log.info('收到响应: %o', { image_id });
        previewUrl = `${this.url}/image/${image_id}`;
      } else {
        previewUrl = `${this.url}/memes/${key}/preview`;
      }
      this.log.info('请求地址: %s', previewUrl);
      const resp = await this.ctx.http.get<ArrayBuffer>(previewUrl, { responseType: 'arraybuffer' });
      this.log.info(`收到响应: Buffer(length=${resp.byteLength})`);
      return Buffer.from(resp);
    } catch (e) {
      this.log.error('获取预览图失败: %s', e.message);
      return '获取预览图失败。';
    }
  }

  /**
   * 根据给定参数生成 meme。
   * @param {string} key - 要使用的模板 key。
   * @param {h[]} input - 包含图片、文本和参数的 Koishi 元素数组。
   * @param {Session} session - 当前会话对象。
   * @returns {Promise<h | string>} 解析为一个 h 图像元素或错误字符串的 Promise。
   */
  async create(key: string, input: h[], session: Session): Promise<h | string> {
    const item = await this.getInfo(key, false)
    if (!item) return `模板 “${key}” 不存在。`

    let { imgs, texts, args } = await parseInput(input, session)

    if (this.isRsApi && imgs.length < item.minImages && item.minImages > 0) {
      imgs.unshift(await getAvatar(session))
    }

    if (imgs.length < item.minImages || imgs.length > item.maxImages) {
      return `需要 ${item.minImages}-${item.maxImages} 张图片，但提供了 ${imgs.length} 张。`
    }
    if (texts.length < item.minTexts || texts.length > item.maxTexts) {
      return `需要 ${item.minTexts}-${item.maxTexts} 段文本，但提供了 ${texts.length} 段。`
    }

    try {
      return this.isRsApi
        ? await this.createRs(key, imgs, texts, args)
        : await this.createFast(key, imgs, texts, args)
    } catch (e) {
      this.log.error('Meme 生成失败: ', e)
      return `制作失败: ${e.message}`
    }
  }

  /**
   * @private 从 rs-api 后端获取模板列表。
   * @returns {Promise<MemeInfo[]>}
   */
  private async fetchRs(): Promise<MemeInfo[]> {
    const url = `${this.url}/meme/infos`;
    this.log.info('请求地址: %s', url);
    const data = await this.ctx.http.get<any[]>(url);
    this.log.info(`收到响应: 获取到 ${data.length} 条模板数据。`);
    return data.map(info => this.normRs(info)).filter(Boolean) as MemeInfo[];
  }

  /**
   * @private 将 rs-api 的原始数据规范化为 MemeInfo 格式。
   * @param {any} data - 原始数据。
   * @returns {MemeInfo | null}
   */
  private normRs(data: any): MemeInfo | null {
    if (!data || !data.params) return null
    return {
      key: data.key,
      keywords: data.keywords || [],
      minImages: data.params.min_images,
      maxImages: data.params.max_images,
      minTexts: data.params.min_texts,
      maxTexts: data.params.max_texts,
      defaultTexts: data.params.default_texts || [],
      args: (data.params.options || []).map(opt => ({
        name: opt.name, type: opt.type, default: opt.default, description: opt.description,
        parser_flags: opt.parser_flags, choices: opt.choices, minimum: opt.minimum, maximum: opt.maximum,
      })),
      tags: data.tags || [],
      shortcuts: data.shortcuts || [],
      date_created: data.date_created,
      date_modified: data.date_modified,
    }
  }

  /**
   * @private 将图片 Buffer 上传到 rs-api 后端。
   * @param {Buffer} buf - 图片 Buffer。
   * @returns {Promise<string>} 图片 ID。
   */
  private async upload(buf: Buffer): Promise<string> {
    const url = `${this.url}/image/upload`;
    this.log.info('请求地址: %s (上传图片)', url);
    const payload = { type: 'data', data: buf.toString('base64') };
    const { image_id } = await this.ctx.http.post<{ image_id: string }>(url, payload);
    this.log.info('收到响应: %o', { image_id });
    return image_id;
  }

  /**
   * @private 使用 rs-api 后端生成 meme。
   * @param {string} key - 模板 key。
   * @param {string[]} imgs - 图片 URL 列表。
   * @param {string[]} texts - 文本列表。
   * @param {Record<string, any>} args - 参数对象。
   * @returns {Promise<h>} h 图像元素。
   */
  private async createRs(key: string, imgs: string[], texts: string[], args: Record<string, any>): Promise<h> {
    const imgIds = await Promise.all(
      imgs.map(async (url) => {
        const buf = await this.ctx.http.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
        return this.upload(Buffer.from(buf));
      })
    )

    const url = `${this.url}/memes/${key}`;
    const payload = { images: imgIds.map(id => ({ id })), texts, options: args };
    this.log.info('请求地址: %s, 参数: %o', url, payload);
    const res = await this.ctx.http.post<{ image_id: string }>(url, payload, { timeout: 30000 });
    this.log.info('收到响应: %o', res);

    const finalImageUrl = `${this.url}/image/${res.image_id}`;
    this.log.info('请求地址: %s', finalImageUrl);
    const finalImg = await this.ctx.http.get<ArrayBuffer>(finalImageUrl, { responseType: 'arraybuffer' });
    this.log.info(`收到响应: Buffer(length=${finalImg.byteLength})`);
    return h.image(Buffer.from(finalImg), 'image/gif');
  }

  /**
   * @private 从 FastAPI 后端获取模板列表。
   * @returns {Promise<MemeInfo[]>}
   */
  private async fetchFast(): Promise<MemeInfo[]> {
    const url = `${this.url}/memes/keys`;
    this.log.info('请求地址: %s', url);
    const keys = await this.ctx.http.get<string[]>(url);
    this.log.info('收到响应: %o', keys);
    const promises = keys.map(key => this.fetchFastInfo(key));
    const results = await Promise.allSettled(promises);
    return results
      .filter(res => res.status === 'fulfilled' && res.value)
      .map(res => (res as PromiseFulfilledResult<MemeInfo>).value);
  }

  /**
   * @private 从 FastAPI 后端获取单个模板信息。
   * @param {string} key - 模板 key。
   * @returns {Promise<MemeInfo | null>}
   */
  private async fetchFastInfo(key: string): Promise<MemeInfo | null> {
    const url = `${this.url}/memes/${key}/info`;
    try {
      this.log.info('请求地址: %s', url);
      const data = await this.ctx.http.get<any>(url, { timeout: 10000 });
      this.log.info(`收到响应 (模板 ${key}): %o`, data);
      return this.normFast(data);
    } catch (error) {
      this.log.warn(`获取 FastAPI 模板 '${key}' 的信息失败。`, error.message);
      return null;
    }
  }

  /**
   * @private 将 FastAPI 的原始数据规范化为 MemeInfo 格式。
   * @param {any} data - 原始数据。
   * @returns {MemeInfo | null}
   */
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
      key: data.key,
      keywords: data.keywords || data.aliases || [],
      minImages: params.min_images,
      maxImages: params.max_images,
      minTexts: params.min_texts,
      maxTexts: params.max_texts,
      defaultTexts: params.default_texts || [],
      args: args,
      tags: data.tags || [],
      shortcuts: (data.shortcuts || []).map(sc => ({
        pattern: sc.key, humanized: sc.humanized, names: [], texts: [], options: { _raw_args: sc.args },
      })),
      date_created: data.date_created,
      date_modified: data.date_modified,
    };
  }

  /**
   * @private 使用 FastAPI 后端生成 meme。
   * @param {string} key - 模板 key。
   * @param {string[]} imgs - 图片 URL 列表。
   * @param {string[]} texts - 文本列表。
   * @param {Record<string, any>} args - 参数对象。
   * @returns {Promise<h>} h 图像元素。
   */
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

    const url = `${this.url}/memes/${key}/`;
    this.log.info('请求地址: %s (FormData)', url);
    const result = await this.ctx.http.post<ArrayBuffer>(url, form, {
      responseType: 'arraybuffer', timeout: 30000,
    });
    this.log.info(`收到响应: Buffer(length=${result.byteLength})`);
    return h.image(Buffer.from(result), 'image/gif');
  }

  /**
   * 注册 rs-api 专属的图片处理工具子命令。
   * @param {Command} cmd - 要挂载子命令的 `meme` 主命令。
   * @returns {void}
   */
  public createToolCmds(cmd: Command): void {
    const tool = cmd.subcommand('.tool', '图片处理工具');

    const addTool = (name: string, desc: string, endpoint: string) => {
      tool.subcommand(`.${name} <image:img>`, desc)
        .action(async ({ session }, img) => {
          if (!img?.attrs.src) return '请提供一张图片。';
          try {
            const buf = await this.ctx.http.get(img.attrs.src, { responseType: 'arraybuffer' });
            const imgId = await this.upload(Buffer.from(buf));
            const url = `${this.url}/tools/image_operations/${endpoint}`;
            this.log.info('请求地址: %s', url);
            const res = await this.ctx.http.post<{ image_id: string }>(url, { image_id: imgId });
            this.log.info('收到响应: %o', res);
            const finalBuf = await this.ctx.http.get(`${this.url}/image/${res.image_id}`, { responseType: 'arraybuffer' });
            return h.image(finalBuf, 'image/png');
          } catch (e) {
            this.log.error('图片处理失败: ', e);
            return `处理失败: ${e.message}`;
          }
        });
    };

    addTool('hflip', '水平翻转图片', 'flip_horizontal');
    addTool('vflip', '垂直翻转图片', 'flip_vertical');
    addTool('grayscale', '灰度化图片', 'grayscale');
    addTool('invert', '反色图片', 'invert');
    addTool('gif.reverse', '倒放 GIF', 'gif_reverse');
  }
}
