import { Context, Command, h, Logger } from 'koishi'
import { parseTarget, autoRecall } from './index'
import axios from 'axios'
import fs from 'fs'
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
 * 负责加载、管理和调用外部表情 API
 */
export class MemeAPI {
  private ctx: Context;
  private apiConfigs: ApiConfig[] = [];
  private logger: Logger;
  private configPath: string;

  /**
   * 创建一个 MemeAPI 实例
   * @param ctx Koishi 上下文
   * @param logger 日志记录器
   */
  constructor(ctx: Context, logger: Logger) {
    this.ctx = ctx
    this.logger = logger
    this.configPath = path.resolve(this.ctx.baseDir, 'data', 'memes-api.json')
    this.loadConfig()
  }

  /**
   * 加载外部配置文件
   * 如果配置文件不存在，会创建默认配置
   * @private
   */
  private loadConfig() {
    if (!fs.existsSync(this.configPath)) {
      try {
        const defaultConfig: ApiConfig[] = [
          {
            description: "示例配置",
            apiEndpoint: "https://example.com/api?qq=${arg1}&target=${arg2}"
          }
        ]
        fs.writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8')
        this.logger.info(`已创建配置文件：${this.configPath}`)
        this.apiConfigs = defaultConfig
      } catch (err) {
        this.logger.error(`创建配置失败：${err.message}`)
      }
      return
    }
    // 读取配置文件
    try {
      const content = fs.readFileSync(this.configPath, 'utf-8')
      this.apiConfigs = JSON.parse(content)
      this.logger.info(`已加载配置文件：${this.apiConfigs.length}项`)
    } catch (err) {
      this.logger.error(`加载配置失败：${err.message}`)
    }
  }

  /**
   * 注册所有子命令
   * 包括 api、list 和 reload 子命令
   * @param meme 父命令对象
   */
  registerCommands(meme: Command) {
    const api = meme.subcommand('.api [type:string] [arg1:string] [arg2:string]', '使用自定义API生成表情')
      .usage('输入类型并补充对应参数来生成对应表情')
      .example('memes.api 吃 @用户 - 生成"吃"表情')
      .action(async ({ session }, type, arg1, arg2) => {
        // 查找索引
        const index = !type
          ? Math.floor(Math.random() * this.apiConfigs.length)
          : this.apiConfigs.findIndex(config =>
              config.description.split('|')[0].trim() === type.trim()
            );
        if (index === -1) {
          const msg = await session.send(`未找到表情"${type}"`);
          autoRecall(session, msg);
          return;
        }
        try {
          const config = this.apiConfigs[index];
          const parsedArg1 = parseTarget(arg1)
          const parsedArg2 = parseTarget(arg2)
          // 替换占位符
          let apiUrl = config.apiEndpoint
            .replace(/\${arg1}/g, parsedArg1)
            .replace(/\${arg2}/g, parsedArg2)
          // 请求图片
          const response = await axios.get(apiUrl, {
            timeout: 8000,
            validateStatus: () => true,
            responseType: 'text'
          })
          let imageUrl = apiUrl;
          if (response.headers['content-type']?.includes('application/json')) {
            const data = typeof response.data === 'string'
              ? JSON.parse(response.data)
              : response.data
            if (data?.code === 200) imageUrl = data.data;
          }
          return h('image', { url: imageUrl })
        } catch (err) {
          const msg = await session.send('生成出错：' + err.message);
          autoRecall(session, msg);
          return;
        }
      })
    api.subcommand('.list [page:string]', '列出可用模板列表')
      .usage('输入页码查看列表或使用"all"查看所有模板')
      .action(({}, page) => {
        const ITEMS_PER_PAGE = 10
        const showAll = page === 'all'
        const pageNum = typeof page === 'string' ? parseInt(page) || 1 : (page || 1)
        // 格式化表情描述
        const typeDescriptions = this.apiConfigs.map(config => config.description)
        const lines = []
        let currentLine = ''
        let currentWidth = 0
        const MAX_WIDTH = 36
        const SEPARATOR = ' '
        for (const description of typeDescriptions) {
          let descWidth = 0;
          for (const char of description) {
            descWidth += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(char) ? 2 : 1;
          }
          if (currentWidth + descWidth + 1 > MAX_WIDTH && currentWidth > 0) {
            lines.push(currentLine)
            currentLine = description
            currentWidth = descWidth
          } else if (currentLine.length === 0) {
            currentLine = description
            currentWidth = descWidth
          } else {
            currentLine += SEPARATOR + description
            currentWidth += 1 + descWidth
          }
        }
        if (currentLine.length > 0) {
          lines.push(currentLine)
        }
        const totalPages = Math.ceil(lines.length / ITEMS_PER_PAGE)
        const validPage = Math.max(1, Math.min(pageNum, showAll ? 1 : totalPages))
        const displayLines = showAll
          ? lines
          : lines.slice((validPage - 1) * ITEMS_PER_PAGE, validPage * ITEMS_PER_PAGE)
        // 构建页面
        const header = showAll
          ? `表情模板列表（共${this.apiConfigs.length}项）\n`
          : totalPages > 1
            ? `表情模板列表（${validPage}/${totalPages}页）\n`
            : "表情模板列表\n"

        return header + displayLines.join('\n')
      })
    api.subcommand('.reload', '重载自定义API配置', { authority: 3 })
      .action(async ({ session }) => {
        try {
          const content = fs.readFileSync(this.configPath, 'utf-8')
          this.apiConfigs = JSON.parse(content)
          return `已重载配置文件：${this.apiConfigs.length}项`
        } catch (err) {
          const msg = await session.send('重载配置失败：' + err.message);
          autoRecall(session, msg);
          return;
        }
      })
  }
}
