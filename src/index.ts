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
  cacheEnabled: boolean
}

export const Config: Schema<Config> = Schema.object({
  loadApi: Schema.boolean()
    .description('开启自定义 API 生成功能').default(false),
  genUrl: Schema.string()
    .description('MemeGenerator API 配置').default('http://localhost:2233'),
  cacheEnabled: Schema.boolean()
    .description('启用表情模板缓存').default(true)
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
 * 获取缓存文件路径
 */
function getCachePath(ctx: Context): string {
  return path.resolve(ctx.baseDir, 'data', 'memes.json')
}

/**
 * 加载缓存
 */
async function loadCache(ctx: Context): Promise<MemeInfo[]> {
  const cachePath = getCachePath(ctx)
  try {
    if (fs.existsSync(cachePath)) {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
      if (cacheData.time && cacheData.data) {
        lastCacheTime = cacheData.time
        return cacheData.data
      }
    }
  } catch (e) {
    logger.error(`加载缓存失败：${e.message}`)
  }
  return []
}

/**
 * 保存缓存
 */
async function saveCache(ctx: Context, data: MemeInfo[]): Promise<void> {
  const cachePath = getCachePath(ctx)
  try {
    const dir = path.dirname(cachePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    lastCacheTime = Date.now()
    fs.writeFileSync(cachePath, JSON.stringify({
      time: lastCacheTime,
      data: data
    }, null, 2), 'utf-8')
    logger.info(`已创建缓存文件：${data.length}项`)
  } catch (e) {
    logger.error(`创建缓存失败：${e.message}`)
  }
}

/**
 * 刷新缓存
 */
async function refreshCache(ctx: Context, apiUrl: string): Promise<MemeInfo[]> {
  try {
    // 获取所有模板ID
    const keys = await apiRequest<string[]>(`${apiUrl}/memes/keys`)
    logger.info(`已获取模板ID: ${keys.length}个`)
    // 获取每个模板的详细信息
    const templates: MemeInfo[] = []
    for (const key of keys) {
      try {
        const info = await apiRequest<any>(`${apiUrl}/memes/${key}/info`)
        templates.push({
          id: key,
          keywords: info.keywords ? (Array.isArray(info.keywords) ? info.keywords : [info.keywords]).filter(Boolean) : [],
          tags: info.tags && Array.isArray(info.tags) ? info.tags : [],
          params_type: info.params_type || {},
          ...info
        })
      } catch (e) {
        logger.warn(`获取模板[${key}]信息失败：${e.message}`)
        templates.push({
          id: key,
          keywords: [],
          tags: [],
          params_type: {}
        })
      }
    }
    // 保存缓存
    await saveCache(ctx, templates)
    memeCache = templates
    return templates
  } catch (e) {
    logger.error(`刷新缓存失败：${e.message}`)
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
  const targetId = userId || session.userId;
  // 优先使用会话用户自己的头像
  if (targetId === session.userId && session.user?.avatar) {
    return session.user.avatar;
  }
  // 默认返回QQ头像
  return `https://q1.qlogo.cn/g?b=qq&nk=${targetId}&s=640`;
}

/**
 * 自动撤回消息
 */
export async function autoRecall(session: any, message: any, delay: number = 10000) {
  if (!message || !session.bot?.deleteMessage) return
  setTimeout(async () => {
    try {
      await session.bot.deleteMessage(session.channelId, message.id)
    } catch (e) {
      logger.debug(`撤回消息失败：${e}`)
    }
  }, delay)
}

/**
 * 发送临时错误消息
 */
async function sendTempError(session: any, message: string): Promise<null> {
  const msg = await session.send(message);
  autoRecall(session, msg);
  return null;
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
} = {}): Promise<T> {
  const {
    method = 'get',
    data,
    formData,
    responseType = 'json',
    timeout = 8000
  } = options;
  try {
    const response = await axios({
      url,
      method,
      data: formData || data,
      headers: formData ? { 'Accept': 'image/*,application/json' } : undefined,
      responseType: responseType === 'arraybuffer' ? 'arraybuffer' : 'json',
      timeout,
      validateStatus: () => true
    });
    // 处理非成功状态码
    if (response.status !== 200) {
      if (responseType === 'arraybuffer') {
        try {
          const errText = Buffer.from(response.data).toString('utf-8');
          const errJson = JSON.parse(errText);
          throw new Error(errJson.error || errJson.message || `HTTP状态码 ${response.status}`);
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new Error(`HTTP状态码 ${response.status}`);
          }
          throw e;
        }
      } else {
        throw new Error(response.data?.error || response.data?.message || `HTTP状态码 ${response.status}`);
      }
    }
    return response.data as T;
  } catch (e) {
    throw new Error(`API请求失败：${e.message}`);
  }
}

/**
 * 从URL获取图片Blob
 */
async function getImageBlob(url: string): Promise<Blob> {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 8000
    });
    const buffer = Buffer.from(response.data);
    return new Blob([buffer], { type: response.headers['content-type'] || 'image/png' });
  } catch (e) {
    throw new Error(`获取图片失败：${e.message}`);
  }
}

/**
 * 检查数值是否在范围内并格式化范围显示
 */
function checkAndFormatRange(value: number, min?: number, max?: number): { valid: boolean, display: string } {
  const valid = (min == null || value >= min) && (max == null || value <= max);
  let display = '';
  if (min === max) display = `${min}`;
  else if (min != null && max != null) display = `${min}-${max}`;
  else if (min != null) display = `至少${min}`;
  else if (max != null) display = `最多${max}`;
  return { valid, display };
}

/**
 * 从文本中分割参数
 */
function splitArgString(text: string): string[] {
  const matched = text.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g)
  if (!matched) return []
  return matched.map(v => v.replace(/^["']|["']$/g, ''))
}

/**
 * 处理命令参数并提取图片和文本
 */
async function processArgs(session: any, args: h[]) {
  const imageInfos: Array<{ src: string } | { userId: string }> = [];
  const texts: string[] = [];
  // 添加引用消息中的图片
  if (session.quote?.elements) {
    const processElement = (e: h) => {
      if (e.children?.length) {
        for (const child of e.children) processElement(child);
      }
      if (e.type === 'img' && e.attrs.src) {
        imageInfos.push({ src: e.attrs.src });
      }
    };
    for (const element of session.quote.elements) {
      processElement(element);
    }
  }
  // 处理参数中的图片和文本
  const textBuffer: string[] = [];
  const resolveBuffer = () => {
    if (!textBuffer.length) return;
    const text = textBuffer.join('');
    // 检查文本中是否有 <at id="xxx"/> 格式的标签
    const atRegex = /<at\s+id="(\d+)"\s*\/>/g;
    let match;
    let lastIndex = 0;
    let hasAtTag = false;
    // 查找所有 at 标签
    while ((match = atRegex.exec(text)) !== null) {
      hasAtTag = true;
      // 处理 at 标签前的文本
      if (match.index > lastIndex) {
        const segment = text.substring(lastIndex, match.index);
        const segmentTexts = splitArgString(segment).filter(v => {
          if (v.startsWith('-u')) {
            imageInfos.push({ userId: v.slice(2) });
            return false;
          }
          if (v.startsWith('@')) {
            imageInfos.push({ userId: parseTarget(v) });
            return false;
          }
          return true;
        });
        texts.push(...segmentTexts);
      }
      // 处理 at 标签
      imageInfos.push({ userId: match[1] });
      lastIndex = match.index + match[0].length;
    }
    // 如果没有找到 at 标签，或者处理完最后一个 at 标签后还有文本
    if (!hasAtTag || lastIndex < text.length) {
      const remainingText = hasAtTag ? text.substring(lastIndex) : text;
      const bufferTexts = splitArgString(remainingText).filter(v => {
        if (v.startsWith('-u')) {
          imageInfos.push({ userId: v.slice(2) });
          return false;
        }
        if (v.startsWith('@')) {
          imageInfos.push({ userId: parseTarget(v) });
          return false;
        }
        return true;
      });
      texts.push(...bufferTexts);
    }
    textBuffer.length = 0;
  };
  const processElement = (e: h) => {
    if (e.children?.length) {
      for (const child of e.children) processElement(child);
    }
    if (e.type === 'text') {
      if (e.attrs.content) textBuffer.push(e.attrs.content);
      return;
    }
    resolveBuffer();
    if (e.type === 'img' && e.attrs.src) {
      imageInfos.push({ src: e.attrs.src });
    } else if (e.type === 'at' && e.attrs.id) {
      imageInfos.push({ userId: e.attrs.id });
    }
  };
  for (const element of args) {
    processElement(element);
  }
  resolveBuffer();
  return { imageInfos, texts };
}

/**
 * 处理模板参数并验证
 */
async function processTemplateParameters(session: any, key: string, args: h[], apiUrl: string) {
  try {
    // 优先从缓存获取模板信息
    let templateInfo;
    const cachedTemplate = memeCache.find(t => t.id === key);
    if (cachedTemplate) {
      templateInfo = cachedTemplate;
    } else {
      templateInfo = await apiRequest(`${apiUrl}/memes/${key}/info`);
    }
    const paramsType = templateInfo.params_type || {};
    const {
      min_images: minImages = 0,
      max_images: maxImages = 0,
      min_texts: minTexts = 0,
      max_texts: maxTexts = 0,
      default_texts: defaultTexts = []
    } = paramsType;
    // 解析参数
    const hArgs = args.map(arg => typeof arg === 'string' ? h('text', { content: arg }) : arg);
    const { imageInfos, texts } = await processArgs(session, hArgs);
    // 使用发送者头像
    let processedImageInfos = [...imageInfos];
    const autoUseAvatar = !!(
      (!imageInfos.length && minImages === 1) ||
      (imageInfos.length && imageInfos.length + 1 === minImages)
    );
    if (autoUseAvatar) {
      processedImageInfos.unshift({ userId: session.userId });
    }
    // 使用默认文本
    let processedTexts = [...texts];
    if (!texts.length) {
      processedTexts.push(...defaultTexts);
    }
    // 验证参数数量
    const imagesCheck = checkAndFormatRange(processedImageInfos.length, minImages, maxImages);
    if (!imagesCheck.valid) {
      return sendTempError(session, `图片提供(${processedImageInfos.length}/${imagesCheck.display})张`);
    }
    const textsCheck = checkAndFormatRange(processedTexts.length, minTexts, maxTexts);
    if (!textsCheck.valid) {
      return sendTempError(session, `文本提供(${processedTexts.length}/${textsCheck.display})条`);
    }
    // 处理图片和用户信息
    const images: Blob[] = [];
    const userInfos: any[] = [];
    for (const info of processedImageInfos) {
      try {
        if ('src' in info) {
          const blob = await getImageBlob(info.src);
          images.push(blob);
          userInfos.push({});
        } else if ('userId' in info) {
          const avatarUrl = await getUserAvatar(session, info.userId);
          const blob = await getImageBlob(avatarUrl);
          images.push(blob);
          userInfos.push({ name: info.userId });
        }
      } catch (e) {
        throw new Error(`获取图片失败：${e.message}`);
      }
    }
    return { templateInfo, images, texts: processedTexts, userInfos };
  } catch (e) {
    throw new Error(`处理模板参数失败：${e.message}`);
  }
}

/**
 * 生成表情包
 */
async function generateMeme(apiUrl: string, key: string, images: Blob[], texts: string[], userInfos: any[]) {
  const formData = new FormData();
  // 添加文本和图片
  texts.forEach(text => formData.append('texts', text));
  images.forEach(img => formData.append('images', img));
  // 添加其他参数
  formData.append('args', JSON.stringify({ user_infos: userInfos }));
  try {
    // 请求生成表情包
    return await apiRequest<Buffer>(`${apiUrl}/memes/${key}/`, {
      method: 'post',
      formData,
      responseType: 'arraybuffer',
      timeout: 10000
    });
  } catch (e) {
    throw new Error(`生成表情失败: ${e.message}`);
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
    if (!apiUrl || !config.cacheEnabled) return
    // 加载本地缓存
    memeCache = await loadCache(ctx)
    logger.info(`已加载缓存文件：${memeCache.length}项`)
    // 如果没有缓存，则获取一次
    if (memeCache.length === 0) {
      await refreshCache(ctx, apiUrl)
    }
  }
  // 初始化缓存
  initCache()

  const meme = ctx.command('memes [key:string] [...texts:text]', '制作表情包')
    .usage('输入类型并补充对应参数来生成对应表情')
    .example('memes eat - 生成"吃"表情')
    .action(async ({ session }, key, ...args) => {
      if (!key) {
        return sendTempError(session, '请提供模板ID和文本参数');
      }
      try {
        // 处理模板参数
        const hArgs = args.map(arg => h('text', { content: arg }));
        const result = await processTemplateParameters(session, key, hArgs, apiUrl);
        if (!result) return;
        const { images, texts, userInfos } = result;
        // 生成表情包
        const imageBuffer = await generateMeme(apiUrl, key, images, texts, userInfos);
        // 返回图片
        const base64 = Buffer.from(imageBuffer).toString('base64');
        const dataUrl = `data:image/png;base64,${base64}`;
        return h('image', { url: dataUrl });
      } catch (e) {
        logger.error(`生成表情出错: ${e.message}`);
        return sendTempError(session, `生成表情出错: ${e.message}`);
      }
    });

  meme.subcommand('.list [page:string]', '列出可用模板列表')
    .usage('输入页码查看列表或使用"all"查看所有模板')
    .action(async ({ session }, page) => {
      try {
        let keys: string[];
        if (config.cacheEnabled && memeCache.length > 0) {
          keys = memeCache.map(t => t.id);
        } else {
          keys = await apiRequest<string[]>(`${apiUrl}/memes/keys`);
        }
        // 分页处理
        const ITEMS_PER_PAGE = 10;
        const showAll = page === 'all';
        const pageNum = typeof page === 'string' ? (parseInt(page) || 1) : (page || 1);
        const totalPages = Math.ceil(keys.length / ITEMS_PER_PAGE);
        const validPage = Math.max(1, Math.min(pageNum, totalPages));
        const pageKeys = showAll ? keys : keys.slice((validPage - 1) * ITEMS_PER_PAGE, validPage * ITEMS_PER_PAGE);
        // 获取当前页模板详情
        const templates = await Promise.all(pageKeys.map(async (key) => {
          try {
            // 优先从缓存获取
            const cachedTemplate = memeCache.find(t => t.id === key);
            if (cachedTemplate) {
              const info = cachedTemplate;
              const keywords = info.keywords || [];
              const tags = info.tags || [];
              const pt = info.params_type || {};
              let imgReq = '';
              let textReq = '';
              if (pt.min_images === pt.max_images) {
                imgReq = pt.min_images > 0 ? `图片${pt.min_images}` : '';
              } else {
                imgReq = pt.min_images > 0 || pt.max_images > 0 ? `图片${pt.min_images}-${pt.max_images}` : '';
              }
              if (pt.min_texts === pt.max_texts) {
                textReq = pt.min_texts > 0 ? `文本${pt.min_texts}` : '';
              } else {
                textReq = pt.min_texts > 0 || pt.max_texts > 0 ? `文本${pt.min_texts}-${pt.max_texts}` : '';
              }
              return {
                id: key,
                keywords,
                imgReq,
                textReq,
                tags
              };
            } else {
              const info = await apiRequest(`${apiUrl}/memes/${key}/info`);
              // 获取关键词和标签
              let keywords = info.keywords ? (Array.isArray(info.keywords) ? info.keywords : [info.keywords]) : [];
              let imgReq = '';
              let textReq = '';
              let tags = info.tags && Array.isArray(info.tags) ? info.tags : [];
              // 获取参数需求
              const pt = info.params_type || {};
              if (pt.min_images === pt.max_images) {
                imgReq = pt.min_images > 0 ? `图片${pt.min_images}` : '';
              } else {
                imgReq = pt.min_images > 0 || pt.max_images > 0 ? `图片${pt.min_images}-${pt.max_images}` : '';
              }
              if (pt.min_texts === pt.max_texts) {
                textReq = pt.min_texts > 0 ? `文本${pt.min_texts}` : '';
              } else {
                textReq = pt.min_texts > 0 || pt.max_texts > 0 ? `文本${pt.min_texts}-${pt.max_texts}` : '';
              }
              return {
                id: key,
                keywords,
                imgReq,
                textReq,
                tags
              };
            }
          } catch (err) {
            return { id: key, keywords: [], imgReq: '', textReq: '', tags: [] };
          }
        }));

        const header = showAll
          ? `表情模板列表（共${keys.length}项）\n`
          : totalPages > 1
            ? `表情模板列表（${validPage}/${totalPages}页）\n`
            : "表情模板列表\n";
        const result = header + templates.map(t => {
          let line = `${t.id}`;
          if (t.keywords && t.keywords.length > 0) {
            line += `|${t.keywords.join(',')}`;
          }
          // 显示参数需求和标签
          if (t.imgReq || t.textReq) {
            const reqParts = [];
            if (t.imgReq) reqParts.push(t.imgReq);
            if (t.textReq) reqParts.push(t.textReq);
            if (reqParts.length > 0) {
              line += ` [${reqParts.join('/')}]`;
            }
          }
          if (t.tags && t.tags.length > 0) {
            line += ` #${t.tags.join(' #')}`;
          }
          return line;
        }).join('\n');
        return result;
      } catch (err) {
        return sendTempError(session, `获取失败: ${err.message}`);
      }
    });

  meme.subcommand('.info [key:string]', '获取模板详细信息')
    .usage('查看指定表情模板的详细信息')
    .example('memes.info play - 查看"play"模板的详细信息')
    .action(async ({ session }, key) => {
      if (!key) {
        return sendTempError(session, '请提供模板ID');
      }
      try {
        // 优先从缓存获取
        let info;
        const cachedTemplate = memeCache.find(t => t.id === key);
        if (cachedTemplate) {
          info = cachedTemplate;
        } else {
          info = await apiRequest(`${apiUrl}/memes/${key}/info`);
        }
        const pt = info.params_type || {};
        const keywords = Array.isArray(info.keywords) ? info.keywords : [info.keywords].filter(Boolean);
        const lines = [`模板"${key}"详细信息:`];
        // 基本信息
        if (keywords.length) lines.push(`关键词: ${keywords.join(', ')}`);
        if (info.tags?.length) lines.push(`标签: ${info.tags.join(', ')}`);
        // 参数需求
        lines.push('需要参数:');
        lines.push(`- 图片: ${pt.min_images || 0}${pt.max_images !== pt.min_images ? `-${pt.max_images}` : ''}张`);
        lines.push(`- 文本: ${pt.min_texts || 0}${pt.max_texts !== pt.min_texts ? `-${pt.max_texts}` : ''}条`);
        if (pt.default_texts?.length) lines.push(`- 默认文本: ${pt.default_texts.join(', ')}`);
        // 其他参数
        if (pt.args_type?.args_model?.properties) {
          lines.push('其他参数:');
          const properties = pt.args_type.args_model.properties;
          const definitions = pt.args_type.args_model.$defs || {};
          for (const key in properties) {
            const prop = properties[key];
            // 构建参数描述
            let typeStr = prop.type || '';
            if (prop.type === 'array' && prop.items?.$ref) {
              const refTypeName = prop.items.$ref.replace('#/$defs/', '').split('/')[0];
              typeStr = `${prop.type}<${refTypeName}>`;
            }
            lines.push(`- ${key}${typeStr ? ` (${typeStr})` : ''}${prop.default !== undefined ? ` 默认值: ${JSON.stringify(prop.default)}` : ''}${prop.description ? ` - ${prop.description}` : ''}`);
            // 处理嵌套属性
            if (prop.items?.$ref) {
              const refTypeName = prop.items.$ref.replace('#/$defs/', '').split('/')[0];
              const refObj = definitions[refTypeName];
              if (refObj?.properties) {
                for (const subKey in refObj.properties) {
                  const subProp = refObj.properties[subKey];
                  let subDesc = `  - ${subKey}`;
                  if (subProp.type) subDesc += ` (${subProp.type})`;
                  if (subProp.default !== undefined) subDesc += ` 默认值: ${JSON.stringify(subProp.default)}`;
                  if (subProp.description) subDesc += ` - ${subProp.description}`;
                  if (subProp.enum?.length) subDesc += ` [可选值: ${subProp.enum.join(', ')}]`;
                  lines.push(subDesc);
                }
              }
            }
          }
        }
        // 命令行参数
        if (pt.args_type?.parser_options?.length) {
          lines.push('命令行参数:');
          pt.args_type.parser_options.forEach(opt => {
            const names = opt.names.join(', ');
            const argInfo = opt.args?.length ?
              opt.args.map(arg => {
                let argDesc = arg.name;
                if (arg.value) argDesc += `:${arg.value}`;
                if (arg.default !== null && arg.default !== undefined) argDesc += `=${arg.default}`;
                return argDesc;
              }).join(' ') : '';
            lines.push(`- ${names} ${argInfo}${opt.help_text ? ` - ${opt.help_text}` : ''}`);
          });
        }
        // 参数示例
        if (pt.args_type?.args_examples?.length) {
          lines.push('参数示例:');
          pt.args_type.args_examples.forEach((example, i) => {
            lines.push(`- 示例${i+1}: ${JSON.stringify(example)}`);
          });
        }
        // 快捷指令信息
        if (info.shortcuts?.length) {
          lines.push('快捷指令:');
          info.shortcuts.forEach(shortcut => {
            lines.push(`- ${shortcut.humanized || shortcut.key}${shortcut.args?.length ? ` (参数: ${shortcut.args.join(' ')})` : ''}`);
          });
        }
        // 时间信息
        if (info.date_created || info.date_modified) {
          lines.push(`创建时间: ${info.date_created}\n修改时间: ${info.date_modified}`);
        }
        return lines.join('\n');
      } catch (err) {
        return sendTempError(session, `获取模板信息失败: ${err.message}`);
      }
    });
  meme.subcommand('.search <keyword:string>', '搜索表情模板')
    .usage('根据关键词搜索表情模板')
    .example('memes.search 吃 - 搜索包含"吃"关键词的表情模板')
    .action(async ({ session }, keyword) => {
      if (!keyword) {
        return sendTempError(session, '请提供搜索关键词');
      }
      try {
        if (config.cacheEnabled && memeCache.length === 0) {
          await refreshCache(ctx, apiUrl);
        }
        const results = memeCache.filter(template =>
          template.keywords.some(k => k.includes(keyword)) ||
          template.tags.some(t => t.includes(keyword)) ||
          template.id.includes(keyword)
        );
        if (results.length === 0) {
          return `未找到表情模板"${keyword}"`;
        }
        const resultLines = results.map(t => {
          let line = `${t.id}`;
          if (t.keywords && t.keywords.length > 0) {
            line += `|${t.keywords.join(',')}`;
          }
          if (t.tags && t.tags.length > 0) {
            line += ` #${t.tags.join(' #')}`;
          }
          return line;
        });
        return `搜索结果（共${results.length}项）:\n` + resultLines.join('\n');
      } catch (err) {
        return sendTempError(session, `搜索失败: ${err.message}`);
      }
    });
  meme.subcommand('.refresh', '刷新表情模板缓存', { authority: 3 })
    .action(async ({ session }) => {
      try {
        await refreshCache(ctx, apiUrl);
        return `已刷新缓存文件：${memeCache.length}项`;
      } catch (err) {
        return sendTempError(session, `刷新缓存失败：${err.message}`);
      }
    });

  // 注册图片生成相关命令
  memeMaker.registerCommands(meme);
  // 初始化并注册外部API命令
  if (config.loadApi) {
    const externalApi = new MemeAPI(ctx, logger)
    externalApi.registerCommands(meme);
  }
}