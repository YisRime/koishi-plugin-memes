import { Context, Command, h, Logger } from 'koishi'
import { parseTarget, autoRecall, loadOrCreateConfig, readJsonFile } from './utils'
import path from 'path'

/**
 * 表情 API 配置接口
 * @interface ApiConfig
 */
export interface ApiConfig {
  description: string;
  apiEndpoint: string;
}

/**
 * 外部表情 API 处理类
 * 负责管理自定义表情 API 的配置并注册相关命令
 */
export class MemeAPI {
  private configPath: string;

  /**
   * 创建一个 MemeAPI 实例
   * @param ctx Koishi 上下文对象
   * @param logger 日志记录器
   */
  constructor(
    private ctx: Context,
    private logger: Logger
  ) {
    this.configPath = path.resolve(this.ctx.baseDir, 'data', 'memes-api.json')
    // 确保配置文件存在
    const defaultConfig: ApiConfig[] = [{
      description: "示例配置",
      apiEndpoint: "https://example.com/api?qq=${arg1}&target=${arg2}"
    }];
    loadOrCreateConfig(this.configPath, defaultConfig, this.logger)
  }

  /**
   * 注册所有表情相关的子命令
   * @param meme 父命令对象
   */
  registerCommands(meme: Command) {
    const api = meme.subcommand('meme [page:string]', '自定义表情生成')
      .usage('使用自定义 API 生成表情\n查看自定义 API 表情模板列表')
      .example('meme all - 查看表情模板列表')
      .action(async ({ }, page) => {
        const apiConfigs = readJsonFile<ApiConfig[]>(this.configPath, this.logger) || [];
        const typeDescriptions = apiConfigs.map(config => config.description)
        const lines = []
        let currentLine = ''
        let currentWidth = 0
        const MAX_WIDTH = 36
        for (const desc of typeDescriptions) {
          let descWidth = 0
          for (const char of desc) {
            descWidth += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(char) ? 2 : 1
          }
          if (currentWidth + descWidth + 1 > MAX_WIDTH && currentWidth > 0) {
            lines.push(currentLine)
            currentLine = desc
            currentWidth = descWidth
          } else if (currentLine.length === 0) {
            currentLine = desc
            currentWidth = descWidth
          } else {
            currentLine += ' ' + desc
            currentWidth += 1 + descWidth
          }
        }
        if (currentLine) lines.push(currentLine)
        // 文本分页
        const ITEMS_PER_PAGE = 10
        const showAll = page === 'all'
        const pageNum = parseInt(page) || 1
        const totalPages = Math.ceil(lines.length / ITEMS_PER_PAGE)
        const validPage = Math.max(1, Math.min(pageNum, showAll ? 1 : totalPages))
        const displayLines = showAll
          ? lines
          : lines.slice((validPage - 1) * ITEMS_PER_PAGE, validPage * ITEMS_PER_PAGE)
        const header = showAll || totalPages <= 1
          ? `表情模板列表（共${apiConfigs.length}项）\n`
          : `表情模板列表（${validPage}/${totalPages}页）\n`
        return header + displayLines.join('\n')
      })

    api.subcommand('.make [type:string] [arg1:string] [arg2:string]', '生成自定义表情')
      .usage('使用自定义 API 生成表情\n将替换${arg1}和${arg2}参数\n支持@用户和QQ号')
      .action(async ({ session }, type, arg1, arg2) => {
        try {
          const apiConfigs = readJsonFile<ApiConfig[]>(this.configPath, this.logger) || [];
          const index = !type
            ? Math.floor(Math.random() * apiConfigs.length)
            : apiConfigs.findIndex(config =>
                config.description.split('|')[0].trim() === type.trim()
              );
          if (index === -1) return autoRecall(session, `未找到表情"${type}"`);
          // 准备API URL
          const apiUrl = apiConfigs[index].apiEndpoint
            .replace(/\${arg1}/g, parseTarget(arg1 || ''))
            .replace(/\${arg2}/g, parseTarget(arg2 || ''));
          // 请求图片
          const response = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) })
          // 处理响应
          let imageUrl = apiUrl
          if (response.headers.get('content-type')?.includes('application/json')) {
            const data = await response.json()
            if (data?.code === 200) imageUrl = data.data
          }
          return h('image', { url: imageUrl })
        } catch (err) {
          return autoRecall(session, '生成出错：' + err.message)
        }
      })
  }
}