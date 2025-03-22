import { Context, Schema, h, Logger } from 'koishi'
import { apiTypes as defaultApiTypes } from './apilist'
import { ExternalMemeAPI } from './external'
import { MemeMaker } from './makeimg'
import axios from 'axios'

export const name = 'memes'
export const inject = {optional: ['puppeteer']}

export const logger = new Logger('memes')

export interface Config {
  loadExt?: boolean
  genUrl?: string
}

export const Config: Schema<Config> = Schema.object({
  loadExt: Schema.boolean()
    .description('加载本地外部 API 配置').default(false),
  genUrl: Schema.string()
    .description('MemeGenerator API 配置').default('http://localhost:2233')
})

/**
 * 解析目标用户ID
 */
export function parseTargetId(arg: string, defaultValue: string): string {
  if (!arg) return defaultValue
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
 * 解析文本和图片
 * @param texts 用户输入的文本
 * @returns 处理后的文本和图片URL数组
 */
function parseTextsAndImages(texts: string[]): { processedTexts: string[], images: string[] } {
  const processedTexts: string[] = []
  const images: string[] = []
  texts.forEach(text => {
    if (text?.startsWith('http') && /\.(jpg|jpeg|png|gif|webp)$/i.test(text)) {
      images.push(text)
    } else {
      try {
        const imageElements = h.select(h.parse(text), 'image')
        if (imageElements[0]?.attrs?.url) {
          images.push(imageElements[0].attrs.url)
        } else {
          processedTexts.push(text)
        }
      } catch {
        processedTexts.push(text)
      }
    }
  })
  return { processedTexts, images }
}

/**
 * 获取用户头像URL
 * @param session 会话信息
 * @returns 头像URL或null
 */
function getUserAvatar(session: any): string | null {
  if (session.user?.avatar) {
    return session.user.avatar
  }
  return `https://q1.qlogo.cn/g?b=qq&nk=${session.userId}&s=640`
}

/**
 * 创建表情生成请求的数据对象
 * @param texts 文本参数数组
 * @param images 图片URL数组
 * @param args 额外参数
 * @returns 请求数据对象
 */
async function createMemeRequestData(
  texts: string[],
  images: string[],
  args: any,
  useFormData: boolean = false
): Promise<any> {
  if (!useFormData) {
    // 使用 JSON 格式（application/json）
    const requestData: any = {}
    // 添加文本和图片数组
    if (texts.length > 0) {
      requestData.texts = texts
    }
    if (images.length > 0) {
      requestData.images = images
    }
    // 添加额外参数
    if (args) {
      requestData.args = typeof args === 'string' ? args : JSON.stringify(args)
    }
    return requestData
  } else {
    // 使用 FormData 格式（multipart/form-data）
    const formData = new FormData()

    // 添加文本参数
    texts.forEach(text => {
      formData.append('texts', text)
    })

    // 添加图片参数
    try {
      for (let i = 0; i < images.length; i++) {
        const imageUrl = images[i]
        try {
          // 如果是 URL，获取图片内容
          const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 8000
          })

          // 从 URL 中推断文件名和类型
          const urlParts = imageUrl.split('/')
          const fileName = urlParts[urlParts.length - 1] || `image_${i}.jpg`
          const contentType = response.headers['content-type'] || 'image/jpeg'

          // 创建文件对象
          const blob = new Blob([response.data], { type: contentType })
          formData.append('images', blob, fileName)
        } catch (err) {
          // 如果获取失败，直接传递 URL
          formData.append('images', imageUrl)
        }
      }
    } catch (err) {
      logger.error(`处理图片失败: ${err.message}`)
      // 如果处理失败，仍然添加原始URL
      images.forEach(url => formData.append('images', url))
    }

    // 添加额外参数
    if (args) {
      formData.append('args', typeof args === 'string' ? args : JSON.stringify(args))
    }

    return formData
  }
}

/**
 * 插件主函数
 */
export function apply(ctx: Context, cfg: Config) {
  const apiUrl = !cfg.genUrl ? '' : cfg.genUrl.trim().replace(/\/+$/, '')
  const externalApi = new ExternalMemeAPI(ctx, cfg.loadExt, defaultApiTypes, logger)
  const memeMaker = new MemeMaker(ctx, logger)
  // 检查API连接
  axios.get(`${apiUrl}/meme/version`, { timeout: 10000, validateStatus: () => true })
    .then(response => logger.info(response.status === 200 ? '连接 API 成功' : `无法连接: ${apiUrl}`))
    .catch(() => logger.info(`无法连接: ${apiUrl}`))

  const meme = ctx.command('memes [templateId:string] [...texts:text]', '制作 Meme 表情')
    .usage('示例: memes drake 不学习 学习')
    .example('memes drake 不用koishi 用koishi - 生成对比模板')
    .action(async ({ session }, templateId, ...texts) => {
      if (!templateId) return '请提供模板ID和文本参数'
      try {
        // 处理参数
        const { processedTexts, images } = parseTextsAndImages(texts)

        // 获取模板信息
        let templateInfo
        let needsImage = false
        let needsText = false
        let defaultTexts = []
        let argsType = null

        try {
          const infoResponse = await axios.get(`${apiUrl}/memes/${templateId}/info`, {
            timeout: 8000,
            validateStatus: () => true
          })

          if (infoResponse.status === 200) {
            templateInfo = typeof infoResponse.data === 'string'
              ? JSON.parse(infoResponse.data)
              : infoResponse.data

            // 分析参数需求
            if (templateInfo?.params_type) {
              const pt = templateInfo.params_type
              needsImage = (pt.min_images > 0)
              needsText = (pt.min_texts > 0)
              argsType = pt.args_type

              // 收集默认文本
              if (pt.default_texts && pt.default_texts.length > 0) {
                defaultTexts = [...pt.default_texts]
              }
            } else if (templateInfo?.params) {
              // 兼容旧版参数格式
              needsImage = templateInfo.params.some(p => p.type === 'image')
              needsText = templateInfo.params.some(p => p.type === 'text')
            } else {
              // 默认假设
              needsText = true
            }
          }
        } catch (err) {
          logger.warn(`模板信息获取失败: ${err.message}`)
          // 默认假设
          needsText = true
        }

        // 智能添加参数
        let requestTexts = [...processedTexts]
        let requestImages = [...images]

        // 如果没有提供文本但模板需要文本，添加默认文本
        if (requestTexts.length === 0 && needsText && defaultTexts.length > 0) {
          requestTexts = [...defaultTexts]
          logger.info(`使用默认文本: ${defaultTexts.join(', ')}`)
        }

        // 如果需要图片且没有提供图片，添加用户头像
        if (requestImages.length === 0 && needsImage) {
          const avatarUrl = getUserAvatar(session)
          if (avatarUrl) {
            requestImages.push(avatarUrl)
            logger.info(`添加用户头像: ${avatarUrl.substring(0, 50)}...`)
          }
        }

        // 确定是否使用 FormData
        const useFormData = requestImages.length > 0

        // 创建请求数据
        const requestData = await createMemeRequestData(
          requestTexts,
          requestImages,
          argsType,
          useFormData
        )

        logger.info(`请求模板: ${templateId}, 参数: 文本${requestTexts.length}个, 图片${requestImages.length}个, 格式: ${useFormData ? 'FormData' : 'JSON'}`)

        // 准备请求头
        const headers = useFormData
          ? {
              'Accept': 'image/*,application/json'
            }
          : {
              'Content-Type': 'application/json',
              'Accept': 'image/*,application/json'
            }

        // 发送请求
        const response = await axios.post(`${apiUrl}/memes/${templateId}/`, requestData, {
          headers,
          timeout: 15000,
          responseType: 'arraybuffer',
          validateStatus: () => true
        })

        // 处理响应
        if (response.status !== 200) {
          throw new Error(`状态码 ${response.status}`)
        }

        // 检查Content-Type
        const contentType = response.headers['content-type'] || ''

        // 处理响应结果
        if (contentType.startsWith('image/')) {
          // 图像类型的响应
          const buffer = Buffer.from(response.data)
          const base64 = buffer.toString('base64')
          const dataUrl = `data:${contentType};base64,${base64}`
          return h('image', { url: dataUrl })
        } else {
          // 其他类型的响应
          try {
            // 尝试解析为文本
            const textData = Buffer.from(response.data).toString('utf-8')

            // 判断是否是JSON
            if (contentType.includes('application/json') || textData.trim().startsWith('{')) {
              try {
                const jsonData = JSON.parse(textData)

                // 判断是否为URL
                if (typeof jsonData === 'string' && jsonData.startsWith('http')) {
                  return h('image', { url: jsonData })
                } else if (jsonData?.url) {
                  return h('image', { url: jsonData.url })
                }
              } catch {}
            }

            // 检查是否是base64编码的图片或URL
            if (textData.startsWith('data:image')) {
              return h('image', { url: textData })
            } else if (textData.startsWith('http')) {
              return h('image', { url: textData })
            }

            // 无法识别的响应
            logger.warn(`API返回格式异常: ${textData.substring(0, 100)}${textData.length > 100 ? '...' : ''}`)
            throw new Error('API返回格式错误')
          } catch (err) {
            logger.error(`解析响应失败: ${err.message}`)
            throw new Error(`解析响应失败: ${err.message}`)
          }
        }
      } catch (err) {
        logger.error(`生成失败: ${err.message}`, err.stack)
        return `生成失败: ${err.message}`
      }
    })
  meme.subcommand('.list [page:string]', '列出模板列表')
    .usage('使用"all"显示全部，或数字查看指定页码')
    .action(async ({}, page) => {
      try {
        // 使用 /memes/keys 端点获取模板列表
        const response = await axios.get(`${apiUrl}/memes/keys`, {
          timeout: 8000,
          validateStatus: () => true
        });

        if (response.status !== 200) {
          return `获取模板列表失败: 状态码 ${response.status}`;
        }

        // 提取模板键名
        const keys = Array.isArray(response.data) ? response.data : [];
        if (keys.length === 0) {
          return '无可用模板';
        }

        // 将键名转换为简单的模板对象
        const templates = keys.map(key => ({
          id: key,
          name: key
        }));

        logger.info(`成功获取${templates.length}个模板`);

        // 分页处理
        const ITEMS_PER_PAGE = 20; // 增加每页显示数量
        const showAll = page === 'all';
        const pageNum = typeof page === 'string' ? (parseInt(page) || 1) : (page || 1);
        const totalPages = Math.ceil(templates.length / ITEMS_PER_PAGE);
        const validPage = Math.max(1, Math.min(pageNum, totalPages));

        // 显示逻辑
        const displayTemplates = showAll
          ? templates
          : templates.slice((validPage - 1) * ITEMS_PER_PAGE, validPage * ITEMS_PER_PAGE);

        let result = '';

        // 添加头部信息
        if (showAll) {
          result += `全部表情模板（共${templates.length}项）\n`;
        } else if (totalPages > 1) {
          result += `表情模板（第${validPage}/${totalPages}页，共${templates.length}项）\n`;
        } else {
          result += `表情模板（共${templates.length}项）\n`;
        }

        // 格式化模板信息 - 简单展示ID
        result += displayTemplates.map(t => t.id).join('\n');

        // 添加页脚信息
        if (!showAll) {
          result += `\n\n使用方法：`;
          result += `\n- .list all - 查看全部模板`;
          result += `\n- .list <页码> - 查看指定页，当前共${totalPages}页`;
          result += `\n- .test info <模板ID> - 查看模板详细信息`;
        }

        return result;
      } catch (err) {
        logger.error(`获取模板列表失败: ${err.message}`, err.stack);
        return `获取失败: ${err.message}`;
      }
    });

  // 新增.info命令
  meme.subcommand('.info [key:string]', '查看特定模板的详细信息')
    .usage('例如: .info drake - 查看drake模板的信息')
    .example('.info scroll - 查看scroll模板的详细信息')
    .action(async ({}, key) => {
      try {
        if (!key) return '请提供模板ID';

        // 获取模板信息
        const response = await axios.get(`${apiUrl}/memes/${key}/info`, {
          timeout: 8000,
          validateStatus: () => true,
        });

        if (response.status !== 200) {
          return `获取模板信息失败: 状态码 ${response.status}`;
        }

        // 解析模板信息
        let info;
        try {
          if (typeof response.data === 'string') {
            info = JSON.parse(response.data);
          } else {
            info = response.data;
          }
        } catch (e) {
          return `模板 "${key}" 信息解析失败: ${e.message}`;
        }

        // 确保info是对象
        if (!info || typeof info !== 'object') {
          return `模板 "${key}" 信息格式不正确`;
        }

        // 精简信息输出
        let result = `模板 "${key}" 信息:\n`;

        // 添加基本属性
        if (info.keywords && info.keywords.length) {
          const keywords = Array.isArray(info.keywords) ? info.keywords.join(', ') : info.keywords;
          result += `- 关键词: ${keywords}\n`;
        }

        // 专注处理 params_type 格式
        if (info.params_type) {
          const pt = info.params_type;
          result += `- 图片参数: 最少${pt.min_images || 0}个, 最多${pt.max_images || '无限制'}个\n`;
          result += `- 文本参数: 最少${pt.min_texts || 0}个, 最多${pt.max_texts || '无限制'}个\n`;

          // 显示默认文本
          if (pt.default_texts && pt.default_texts.length > 0) {
            result += `- 默认文本: ${pt.default_texts.join(' | ')}\n`;
          }
        }

        // 显示标签
        if (info.tags && info.tags.length) {
          result += `- 标签: ${info.tags.join(', ')}\n`;
        }

        // 显示快捷方式
        if (info.shortcuts && info.shortcuts.length) {
          result += `- 快捷方式: ${info.shortcuts.join(', ')}\n`;
        }

        // 添加使用示例
        result += `\n使用示例: memes ${key}${info.params_type?.default_texts ? ' ' + info.params_type.default_texts[0] : ''}`;

        // 添加预览提示
        result += `\n查看预览: .test preview ${key}`;

        return result;
      } catch (err) {
        logger.error(`获取模板信息失败: ${err.message}`, err.stack);
        return `获取失败: ${err.message}`;
      }
    });

  // 添加API测试命令
  meme.subcommand('.test [endpoint:string] [key:string]', '测试 Meme API 接口')
    .usage('可用测试项: keys, info, preview, post')
    .example('.test keys - 测试获取所有模板键名')
    .example('.test info drake - 测试获取特定模板信息')
    .example('.test preview drake - 测试获取特定模板预览')
    .example('.test post 5000choyen 标题 内容 - 测试POST请求生成表情')
    .action(async ({ session }, endpoint = 'keys', key = '', ...params) => {
      try {
        if (!apiUrl) return '未配置API地址';

        // 日志记录测试请求
        logger.info(`开始测试API: ${endpoint} ${key}`);

        switch (endpoint.toLowerCase()) {
          case 'keys': {
            // 测试 /memes/keys 端点
            const response = await axios.get(`${apiUrl}/memes/keys`, {
              timeout: 8000,
              validateStatus: () => true
            });

            if (response.status !== 200) {
              return `测试失败: 状态码 ${response.status}`;
            }

            const keys = Array.isArray(response.data) ? response.data : [];
            return `成功获取模板列表，共${keys.length}个: ${keys.slice(0, 10).join(', ')}${keys.length > 10 ? '...' : ''}`;
          }

          case 'info': {
            // 测试 /memes/{key}/info 端点
            if (!key) return '请提供模板ID';

            const response = await axios.get(`${apiUrl}/memes/${key}/info`, {
              timeout: 8000,
              validateStatus: () => true,
            });

            if (response.status !== 200) {
              return `获取模板信息失败: 状态码 ${response.status}`;
            }

            // 记录原始响应内容以便调试
            const rawResponse = typeof response.data === 'string'
              ? response.data.substring(0, 300)
              : JSON.stringify(response.data).substring(0, 300);
            logger.info(`模板 "${key}" 原始信息: ${rawResponse}`);

            let info;
            // 处理可能是字符串的响应
            if (typeof response.data === 'string') {
              try {
                info = JSON.parse(response.data);
              } catch (e) {
                // 不是JSON，尝试直接使用字符串
                return `模板 "${key}" 信息:\n- 原始响应: ${response.data.substring(0, 500)}`;
              }
            } else {
              info = response.data;
            }

            // 确保info是对象
            if (!info || typeof info !== 'object') {
              return `模板 "${key}" 信息:\n- 无法解析的信息格式`;
            }

            // 格式化输出模板信息
            let result = `模板 "${key}" 信息:\n`;

            // 处理基本属性
            if (info.key) result += `- 模板ID: ${info.key}\n`;
            if (info.name) result += `- 名称: ${info.name}\n`;
            if (info.description) result += `- 描述: ${info.description}\n`;
            if (info.keywords && info.keywords.length) {
              result += `- 关键词: ${Array.isArray(info.keywords) ? info.keywords.join(', ') : info.keywords}\n`;
            }

            // 专注处理 params_type 格式
            if (info.params_type) {
              const pt = info.params_type;
              result += `- 图片参数: 最少${pt.min_images || 0}个, 最多${pt.max_images || '无限制'}个\n`;
              result += `- 文本参数: 最少${pt.min_texts || 0}个, 最多${pt.max_texts || '无限制'}个\n`;

              // 显示默认文本
              if (pt.default_texts && pt.default_texts.length > 0) {
                result += `- 默认文本: ${pt.default_texts.join(' | ')}\n`;
              }

              // 显示args_type信息
              if (pt.args_type) {
                result += `- 参数类型: ${JSON.stringify(pt.args_type)}\n`;
              }
            }

            // 处理其他属性
            if (info.tags && info.tags.length) {
              result += `- 标签: ${info.tags.join(', ')}\n`;
            }
            if (info.shortcuts && info.shortcuts.length) {
              result += `- 快捷方式: ${info.shortcuts.join(', ')}\n`;
            }
            if (info.date_created || info.date_modified) {
              result += `- 创建日期: ${info.date_created || '未知'}\n`;
              result += `- 修改日期: ${info.date_modified || '未知'}\n`;
            }

            return result;
          }

          case 'preview': {
            // 测试 /memes/{key}/preview 端点
            if (!key) return '请提供模板ID';

            const response = await axios.get(`${apiUrl}/memes/${key}/preview`, {
              timeout: 10000,
              responseType: 'arraybuffer',
              validateStatus: () => true
            });

            if (response.status !== 200) {
              return `获取预览图失败: 状态码 ${response.status}`;
            }

            // 转换为base64并返回图片
            const buffer = Buffer.from(response.data, 'binary');
            const base64 = buffer.toString('base64');
            const contentType = response.headers['content-type'] || 'image/png';
            const dataUrl = `data:${contentType};base64,${base64}`;

            return h('image', { url: dataUrl });
          }

          case 'post': {
            // 测试 POST 请求生成表情
            if (!key) return '请提供模板ID';

            // 解析参数
            const { processedTexts, images } = parseTextsAndImages(params);

            // 首先尝试获取模板信息，以确定所需参数类型
            let templateInfo;
            let needsImage = false;
            let needsText = false;
            let defaultTexts = [];
            let argsType = null;

            try {
              const infoResponse = await axios.get(`${apiUrl}/memes/${key}/info`, {
                timeout: 8000,
                validateStatus: () => true
              });

              if (infoResponse.status === 200) {
                const info = typeof infoResponse.data === 'string'
                  ? JSON.parse(infoResponse.data)
                  : infoResponse.data;

                if (info && typeof info === 'object') {
                  templateInfo = info;

                  // 专注处理 params_type 格式
                  if (info.params_type) {
                    const pt = info.params_type;
                    needsImage = (pt.min_images > 0);
                    needsText = (pt.min_texts > 0);
                    argsType = pt.args_type;

                    // 收集默认文本
                    if (pt.default_texts && pt.default_texts.length > 0) {
                      defaultTexts = [...pt.default_texts];
                    }

                    logger.info(`模板 "${key}" 参数需求: 图片=${needsImage}, 文本=${needsText}, 默认文本=${defaultTexts.join(', ')}`);
                  } else {
                    // 无法确定参数需求，使用保守估计
                    logger.warn(`模板 "${key}" 未提供 params_type 信息，使用保守估计`);
                    needsText = true; // 默认假设需要文本
                  }
                }
              }
            } catch (err) {
              logger.warn(`无法获取模板信息: ${err.message}`);
              // 无法获取模板信息，使用默认行为
              needsText = true; // 默认假设需要文本
            }

            // 智能添加参数
            let requestTexts = [...processedTexts];
            let requestImages = [...images];

            // 如果没有提供文本但模板需要文本，添加默认文本
            if (requestTexts.length === 0 && needsText) {
              if (defaultTexts.length > 0) {
                requestTexts = [...defaultTexts];
                logger.info(`使用默认文本: ${defaultTexts.join(', ')}`);
              } else {
                requestTexts = ['示例文本'];
                logger.info('添加示例文本');
              }
            }

            // 只有在需要图片且没有提供图片时，才添加用户头像
            if (requestImages.length === 0 && needsImage) {
              const avatarUrl = getUserAvatar(session);
              if (avatarUrl) {
                requestImages.push(avatarUrl);
                logger.info(`添加用户头像: ${avatarUrl.substring(0, 50)}...`);
              }
            }

            // 确定是否使用 FormData
            const useFormData = requestImages.length > 0;

            // 创建请求数据
            const requestData = await createMemeRequestData(
              requestTexts,
              requestImages,
              argsType,
              useFormData
            );

            logger.info(`POST测试: ${key}, 参数: 文本${requestTexts.length}个, 图片${requestImages.length}个, 格式: ${useFormData ? 'FormData' : 'JSON'}`);

            // 准备请求头
            const headers = useFormData
              ? {
                  'Accept': 'image/*,application/json'
                }
              : {
                  'Content-Type': 'application/json',
                  'Accept': 'image/*,application/json'
                };

            // 发送POST请求
            const response = await axios.post(`${apiUrl}/memes/${key}/`, requestData, {
              headers,
              timeout: 15000,
              responseType: 'arraybuffer',
              validateStatus: () => true
            });

            if (response.status !== 200) {
              return `生成失败: 状态码 ${response.status}`;
            }

            // 检查Content-Type
            const contentType = response.headers['content-type'] || '';

            // 处理响应结果
            if (contentType.startsWith('image/')) {
              // 对于图像类型的响应，直接转换为base64
              const buffer = Buffer.from(response.data);
              const base64 = buffer.toString('base64');
              const dataUrl = `data:${contentType};base64,${base64}`;
              return h('image', { url: dataUrl });
            } else {
              // 对于JSON或文本响应，尝试解析
              try {
                // 转换二进制响应为文本
                const textData = Buffer.from(response.data).toString('utf-8');

                // 如果是JSON格式
                if (contentType.includes('application/json') || textData.trim().startsWith('{')) {
                  const jsonData = JSON.parse(textData);

                  // 判断是否为URL或base64
                  if (typeof jsonData === 'string' && jsonData.startsWith('http')) {
                    return h('image', { url: jsonData });
                  } else if (jsonData?.url) {
                    return h('image', { url: jsonData.url });
                  } else {
                    return `生成成功，但返回格式不是直接图片: ${textData.substring(0, 100)}${textData.length > 100 ? '...' : ''}`;
                  }
                }

                // 检查是否是base64编码的图片
                if (textData.startsWith('data:image')) {
                  return h('image', { url: textData });
                }

                // 检查是否是URL
                if (textData.startsWith('http') && (
                    textData.includes('.jpg') ||
                    textData.includes('.png') ||
                    textData.includes('.gif') ||
                    textData.includes('.webp')
                )) {
                  return h('image', { url: textData });
                }

                // 无法识别的响应
                logger.warn(`API返回格式无法识别: ${textData.substring(0, 100)}${textData.length > 100 ? '...' : ''}`);
                return `生成成功，但无法解析返回结果。Content-Type: ${contentType}`;
              } catch (err) {
                logger.error(`解析响应失败: ${err.message}`);
                return `生成成功，但解析响应失败: ${err.message}`;
              }
            }
          }

          default:
            return `未知的测试端点: ${endpoint}\n可用测试项: keys, info, preview, post`;
        }
      } catch (err) {
        logger.error(`API测试失败: ${err.message}`, err.stack);
        return `测试失败: ${err.message}`;
      }
    });

  // 注册图片生成相关命令
  memeMaker.registerCommands(meme);
  // 注册外部API的子命令
  externalApi.registerCommands(meme);
}
