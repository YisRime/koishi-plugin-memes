import { Context, h, Logger, Command } from 'koishi'
import { MemeInfo } from './generator'
import { autoRecall, apiRequest, getUserAvatar, readJsonFile, writeJsonFile } from './utils'
import path from 'path'

/**
 * 上传图片到服务器并返回 image_id
 * @param apiUrl API 地址
 * @param imageBuffer 图片 Buffer
 * @param logger 日志记录器
 * @returns 图片 ID 或 null
 */
async function uploadImage(apiUrl: string, imageBuffer: Buffer, logger: Logger): Promise<string | null> {
  if (!imageBuffer || imageBuffer.length === 0) return null;
  const base64Data = imageBuffer.toString('base64');
  const payload = { type: 'data', data: base64Data };
  const result = await apiRequest<{ image_id: string }>(
    `${apiUrl}/image/upload`,
    { method: 'post', data: payload, timeout: 10000 },
    logger
  );
  return result?.image_id || null;
}

/**
 * 从服务器获取最终图片
 * @param apiUrl API 地址
 * @param imageId 图片 ID
 * @param logger 日志记录器
 * @returns 图片 Buffer 或 null
 */
async function fetchImage(apiUrl: string, imageId: string, logger: Logger): Promise<Buffer | null> {
  if (!imageId) return null;
  return apiRequest<Buffer>(
    `${apiUrl}/image/${imageId}`,
    { responseType: 'arraybuffer', timeout: 10000 },
    logger
  );
}

/**
 * 兼容 meme-generator-rs 的表情生成器
 */
export class MemeGeneratorRS {
  private memeCache: MemeInfo[] = []
  private cachePath: string

  constructor(
    private ctx: Context,
    private logger: Logger,
    private apiUrl: string = ''
  ) {
    this.apiUrl = apiUrl?.trim().replace(/\/+$/, '')
    this.cachePath = path.resolve(this.ctx.baseDir, 'data', 'memes-rs.json')
    const cacheData = readJsonFile<{ time: number; data: MemeInfo[] }>(this.cachePath, this.logger)
    this.memeCache = cacheData?.data || []
    this.memeCache.length ? this.logger.info(`已加载缓存文件（${this.memeCache.length}项）`) : this.refreshCache()
  }

  /**
   * 刷新模板缓存
   */
  async refreshCache(): Promise<MemeInfo[]> {
    try {
      const infos = await apiRequest<any[]>(`${this.apiUrl}/meme/infos`, {}, this.logger)
      if (!infos?.length) {
        this.logger.warn('获取模板列表失败或为空')
        return []
      }
      this.logger.info(`已获取模板信息: ${infos.length}个`)
      const templates: MemeInfo[] = infos.map(info => ({
        id: info.key,
        keywords: info.keywords || [],
        tags: info.tags || [],
        params_type: {
          min_images: info.params.min_images,
          max_images: info.params.max_images,
          min_texts: info.params.min_texts,
          max_texts: info.params.max_texts,
          default_texts: info.params.default_texts,
          args_type: {
            args_model: {
              properties: (info.params.options || []).reduce((acc, opt) => {
                acc[opt.name] = { type: opt.type, default: opt.default, description: opt.description, enum: opt.choices };
                return acc;
              }, {})
            }
          }
        },
        ...info
      }));
      writeJsonFile(this.cachePath, { time: Date.now(), data: templates }, this.logger)
      this.memeCache = templates
      return templates
    } catch (e) {
      this.logger.error(`刷新缓存失败: ${e.message}`)
      return []
    }
  }

  matchTemplates(key: string): MemeInfo[] {
    if (!key || !this.memeCache.length) return []
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

  async findTemplate(key: string, fuzzy: boolean = true): Promise<MemeInfo | null> {
    const matchedTemplates = fuzzy ?
      this.matchTemplates(key) :
      this.memeCache.filter(t => t.id === key || t.keywords?.some(k => k === key))
    if (matchedTemplates.length > 0) return matchedTemplates[0]
    return null
  }

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
   */
  async generateMeme(session: any, key: string, args: h[]) {
    try {
      const templateInfo = await this.findTemplate(key)
      if (!templateInfo) return autoRecall(session, `获取模板信息失败: ${key}`)
      const tempId = templateInfo.id || key;
      // 1. 解析参数
      const imageSrcs: string[] = [];
      const texts: string[] = [];
      const options: Record<string, any> = {};
      let allText = '';
      const processElement = (e: h): void => {
        if (e.type === 'text' && e.attrs.content) allText += e.attrs.content + ' ';
        else if (e.type === 'at' && e.attrs.id) imageSrcs.push(`avatar:${e.attrs.id}`);
        else if (e.type === 'img' && e.attrs.src) imageSrcs.push(e.attrs.src);
        e.children?.length && e.children.forEach(processElement);
      };
      args.forEach(processElement);
      if (allText.trim()) {
        const tokens = allText.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
        tokens.forEach(token => {
          if (token.startsWith('-')) {
            const optMatch = token.match(/^-{1,2}([a-zA-Z0-9_-]+)(?:=(.*))?$/);
            if (optMatch) {
              const [, key, rawValue = 'true'] = optMatch;
              let value: any = rawValue.replace(/^(['"])(.*)\1$/, '$2');
              if (value === 'true') value = true;
              else if (value === 'false') value = false;
              options[key] = value;
            }
          } else {
            texts.push(token.replace(/^(['"])(.*)\1$/, '$2'));
          }
        });
      }

      // 2. 获取图片 Buffer
      const imageBuffers = await Promise.all(imageSrcs.map(async src => {
        try {
          const url = src.startsWith('avatar:') ? await getUserAvatar(session, src.substring(7)) : src;
          const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!response.ok) return null;
          return Buffer.from(await response.arrayBuffer());
        } catch {
          return null;
        }
      }));

      // 3. 上传图片获取 IDs
      const imageIds = (await Promise.all(imageBuffers
        .filter(Boolean)
        .map(buf => uploadImage(this.apiUrl, buf, this.logger))
      )).filter(Boolean);

      // 4. 构建请求体
      const payload = {
        images: imageIds.map(id => ({ name: 'image', id })),
        texts,
        options
      };

      // 5. 请求生成表情
      const genResult = await apiRequest<{ image_id: string }>(
        `${this.apiUrl}/memes/${tempId}`,
        { method: 'post', data: payload, timeout: 10000 },
        this.logger
      );
      if (!genResult?.image_id) return autoRecall(session, '生成失败: 未收到 image_id');

      // 6. 获取最终图片
      const finalImage = await fetchImage(this.apiUrl, genResult.image_id, this.logger);
      if (!finalImage) return autoRecall(session, '生成失败: 无法获取最终图片');

      return h('image', { url: `data:image/png;base64,${finalImage.toString('base64')}` });
    } catch (e) {
      return autoRecall(session, e.message);
    }
  }
}

/**
 * 注册独有的工具命令
 * @param meme 父命令
 * @param apiUrl API 地址
 * @param logger 日志记录器
 */
export function registerRsToolCommands(meme: Command, apiUrl: string, logger: Logger) {
  const imageOperations = {
    'hflip': { desc: '水平翻转', endpoint: 'flip_horizontal', args: [] },
    'vflip': { desc: '竖直翻转', endpoint: 'flip_vertical', args: [] },
    'gray': { desc: '灰度化', endpoint: 'grayscale', args: [] },
    'invert': { desc: '反色', endpoint: 'invert', args: [] },
    'rotate': { desc: '旋转', endpoint: 'rotate', args: ['degrees:number'] },
  };

  for (const cmd in imageOperations) {
    const op = imageOperations[cmd];
    meme.subcommand(`.${cmd} [image:text] ${op.args.join(' ')}`, op.desc)
      .action(async ({ session }, image, ...cmdArgs) => {
        try {
          const elements = h.parse(image || session.quote?.content || '');
          const imgElement = elements.find(el => el.type === 'img');
          if (!imgElement) return autoRecall(session, '请提供一张图片');

          const response = await fetch(imgElement.attrs.src, { signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new Error('图片获取失败');
          const buffer = Buffer.from(await response.arrayBuffer());

          const image_id = await uploadImage(apiUrl, buffer, logger);
          if (!image_id) throw new Error('图片上传失败');

          const payload: any = { image_id };
          op.args.forEach((arg, i) => {
            const [name] = arg.split(':');
            payload[name] = cmdArgs[i];
          });

          const result = await apiRequest<{ image_id: string }>(
            `${apiUrl}/tools/image_operations/${op.endpoint}`,
            { method: 'post', data: payload },
            logger
          );
          if (!result?.image_id) throw new Error('图片处理失败');

          const finalImage = await fetchImage(apiUrl, result.image_id, logger);
          if (!finalImage) throw new Error('无法获取处理后的图片');

          return h.image(finalImage, 'image/png');
        } catch (err) {
          return autoRecall(session, `处理出错: ${err.message}`);
        }
      });
  }
}
