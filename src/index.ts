import { Context, Schema, h, Logger } from 'koishi'
import { apiTypes as defaultApiTypes } from './apilist'
import { ExternalMemeAPI } from './external'
import axios from 'axios'

export const name = 'memes'

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
  // 首先尝试从user.avatar获取
  if (session.user?.avatar) {
    return session.user.avatar
  }

  // 如果没有avatar但有userId，尝试构建QQ头像URL
  if (session.userId) {
    // QQ头像URL格式
    return `https://q1.qlogo.cn/g?b=qq&nk=${session.userId}&s=640`
  }

  return null
}

/**
 * 创建表情生成请求的数据对象
 */
function createMemeRequestData(texts: string[], images: string[], args: any): any {
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
    requestData.args = typeof args === 'string' ? args : args
  }

  return requestData
}

/**
 * 插件主函数
 */
export function apply(ctx: Context, cfg: Config) {
  const logger = new Logger('memes:gen')
  const apiUrl = !cfg.genUrl ? '' : cfg.genUrl.trim().replace(/\/+$/, '')
  const externalApi = new ExternalMemeAPI(ctx, cfg.loadExt, defaultApiTypes)

  // 检查API连接
  if (apiUrl) {
    axios.get(`${apiUrl}/meme/version`, { timeout: 5000, validateStatus: () => true })
      .then(response => logger.info(response.status === 200 ? 'API连接成功' : `无法连接: ${apiUrl}`))
      .catch(() => logger.info(`无法连接: ${apiUrl}`))
  } else {
    logger.warn('未配置API地址，生成器功能不可用')
  }

  // 主命令：生成表情
  const meme = ctx.command('memes [templateId:string] [...texts:text]', '制作 Meme 表情')
    .usage('示例: memes drake 不学习 学习')
    .example('memes drake 不用koishi 用koishi - 生成对比模板')
    .action(async ({ session }, templateId, ...texts) => {
      if (!apiUrl) return '未配置API地址'
      if (!templateId) return '请提供模板ID和文本参数'

      try {
        // 1. 处理参数（文本和图片）
        const { processedTexts, images } = parseTextsAndImages(texts)

        // 2. 获取模板信息
        let templateInfo;
        try {
          const infoResponse = await axios.get(`${apiUrl}/memes/${templateId}/info`, {
            timeout: 8000,
            validateStatus: () => true
          })

          if (infoResponse.status === 200) {
            templateInfo = infoResponse.data
          }
        } catch (err) {
          logger.warn(`模板信息获取失败: ${err.message}`)
        }

        // 3. 确保参数充足，如果需要更多图片，直接添加用户头像
        const requiredParams = templateInfo?.params?.length || 1
        if ((processedTexts.length + images.length) < requiredParams) {
          // 尝试获取用户头像
          const avatarUrl = getUserAvatar(session)
          if (avatarUrl) {
            images.push(avatarUrl)
            logger.info(`已添加用户头像: ${avatarUrl.substring(0, 50)}...`)
          } else {
            logger.warn(`无法获取用户头像，参数可能不足：需要${requiredParams}个，实际有${processedTexts.length + images.length}个`)
          }
        }

        // 4. 创建并发送POST请求 - 使用JSON而非FormData
        const requestData = createMemeRequestData(processedTexts, images, templateInfo?.args)

        logger.info(`请求模板: ${templateId}, 参数: 文本${processedTexts.length}个, 图片${images.length}个`)

        const response = await axios.post(`${apiUrl}/memes/${templateId}/`, requestData, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 15000,
          validateStatus: () => true
        })

        // 5. 处理响应结果
        if (response.status !== 200) throw new Error(`状态码 ${response.status}`)

        let imageUrl;
        if (typeof response.data === 'string' && response.data.startsWith('http')) {
          imageUrl = response.data
        } else if (response.data?.url) {
          imageUrl = response.data.url
        } else if (typeof response.data === 'string' && response.data.startsWith('data:image')) {
          imageUrl = response.data // 处理Base64图片
        } else {
          logger.warn(`API返回格式异常: ${JSON.stringify(response.data).substring(0, 100)}...`)
          throw new Error('API返回格式错误')
        }

        return h('image', { url: imageUrl })
      } catch (err) {
        logger.error(`生成失败: ${err.message}`, err.stack)
        return `生成失败: ${err.message}`
      }
    })

  // 子命令：列出模板
  meme.subcommand('.list [page:string]', '列出模板列表')
    .usage('使用"all"显示全部，或输入数字查看指定页码')
    .action(async ({}, page) => {
      if (!apiUrl) return '未配置API地址'

      try {
        // 获取全部模板列表 - 使用 /memes/render_list POST接口
        let templates = [];
        let keys = [];

        // 1. 先尝试使用render_list获取完整列表（包含更多信息）
        try {
          const renderListResponse = await axios.post(`${apiUrl}/memes/render_list`, {
            meme_list: [], // 空数组表示获取所有
            text_template: "{keywords}",
            add_category_icon: false
          }, {
            timeout: 10000,
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true
          });

          if (renderListResponse.status === 200 && renderListResponse.data?.meme_list) {
            // 从响应中提取模板信息
            const memeList = renderListResponse.data.meme_list || [];
            keys = memeList.map(item => item.meme_key);

            logger.info(`成功通过render_list获取${keys.length}个模板`);

            // 初始化模板信息，这些信息将在后续获取更详细信息
            templates = memeList.map(item => ({
              id: item.meme_key,
              name: item.meme_key,
              text_count: 1,
              description: '',
              disabled: item.disabled,
              labels: item.labels || []
            }));
          } else {
            throw new Error('render_list返回格式错误');
          }
        } catch (err) {
          // 2. 如果render_list失败，回退到使用/memes/keys
          logger.warn(`通过render_list获取模板失败: ${err.message}，尝试使用/memes/keys`);

          const keysResponse = await axios.get(`${apiUrl}/memes/keys`, {
            timeout: 8000,
            validateStatus: () => true
          });

          if (keysResponse.status !== 200) throw new Error(`状态码 ${keysResponse.status}`);
          keys = Array.isArray(keysResponse.data) ? keysResponse.data : [];

          if (keys.length === 0) return '无可用模板';

          // 初始化模板信息
          templates = keys.map(key => ({
            id: key,
            name: key,
            text_count: 1,
            description: ''
          }));
        }

        // 尝试获取更详细的模板信息
        try {
          // 3. 批量获取模板信息，尝试/memes/info端点
          const infoResponse = await axios.get(`${apiUrl}/memes/info`, {
            timeout: 8000,
            validateStatus: () => true
          });

          if (infoResponse.status === 200 && typeof infoResponse.data === 'object') {
            // 用获取到的信息更新templates数组
            templates = templates.map(template => {
              const info = infoResponse.data[template.id];
              if (info) {
                return {
                  ...template,
                  name: info.name || template.id,
                  text_count: info.params?.length || 1,
                  description: info.description || ''
                };
              }
              return template;
            });
          } else {
            // 4. 如果批量获取失败，针对前20个模板单独获取信息（避免请求过多）
            logger.warn(`批量获取模板信息失败，尝试获取前20个模板的详细信息`);

            const topTemplates = templates.slice(0, 20); // 只获取前20个，避免过多请求
            const detailedInfoPromises = topTemplates.map(async (template) => {
              try {
                const response = await axios.get(`${apiUrl}/memes/${template.id}/info`, {
                  timeout: 5000,
                  validateStatus: () => true
                });

                if (response.status === 200 && response.data) {
                  const info = response.data;
                  return {
                    ...template,
                    name: info.name || template.id,
                    text_count: info.params?.length || 1,
                    description: info.description || ''
                  };
                }
              } catch {}
              return template;
            });

            const detailedTemplates = await Promise.all(detailedInfoPromises);

            // 更新前20个模板的信息
            templates = [
              ...detailedTemplates,
              ...templates.slice(20)
            ];
          }
        } catch (err) {
          logger.warn(`获取详细模板信息失败: ${err.message}`);
        }

        // 分页处理
        const ITEMS_PER_PAGE = 15;
        const showAll = page === 'all';
        const pageNum = typeof page === 'string' ? (parseInt(page) || 1) : (page || 1);
        const totalPages = Math.ceil(templates.length / ITEMS_PER_PAGE);
        const validPage = Math.max(1, Math.min(pageNum, totalPages));

        // 显示逻辑
        const displayTemplates = showAll
          ? templates
          : templates.slice((validPage - 1) * ITEMS_PER_PAGE, validPage * ITEMS_PER_PAGE);

        const header = showAll
          ? `全部表情模板（共${templates.length}项）\n`
          : totalPages > 1
            ? `表情模板（第${validPage}/${totalPages}页，共${templates.length}项）\n`
            : `表情模板（共${templates.length}项）\n`;

        return header + displayTemplates.map(t => {
          const desc = t.description ? ` - ${t.description}` : '';
          const disabled = t.disabled ? ' [禁用]' : '';
          const labels = t.labels?.length ? ` [${t.labels.join(', ')}]` : '';
          return `${t.id}: ${t.name}${disabled}${labels} (需要${t.text_count}段文本)${desc}`;
        }).join('\n') + (showAll ? '' : `\n\n使用 .list all 查看全部，.list <页码> 查看指定页`);
      } catch (err) {
        logger.error(`获取模板列表失败: ${err.message}`, err.stack);
        return `获取失败: ${err.message}`;
      }
    });

  // 注册外部API的子命令
  externalApi.registerCommands(meme);
}
