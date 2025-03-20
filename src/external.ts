import { Context, Command, h, Logger } from 'koishi'
import { ApiConfig } from './apilist'
import { parseTargetId } from './index'
import axios from 'axios'
import fs from 'fs'
import path from 'path'

/**
 * 外部表情API处理类
 */
export class ExternalMemeAPI {
  private ctx: Context
  private apiConfigs: ApiConfig[]
  private logger: Logger
  private enableExternalConfig: boolean
  private configPath: string

  /**
   * 创建外部API处理实例
   */
  constructor(ctx: Context, loadExternal: boolean, defaultConfigs: ApiConfig[]) {
    this.ctx = ctx
    this.logger = new Logger('memes:external')
    this.enableExternalConfig = loadExternal
    this.configPath = path.resolve(this.ctx.baseDir, 'data', 'memes.json')

    // 加载配置
    if (!this.enableExternalConfig) {
      this.apiConfigs = defaultConfigs
      return
    }

    if (!fs.existsSync(this.configPath)) {
      try {
        fs.writeFileSync(this.configPath, JSON.stringify(defaultConfigs, null, 2), 'utf-8')
        this.logger.info(`已创建配置文件：${this.configPath}`)
        this.apiConfigs = defaultConfigs
      } catch (err) {
        this.logger.error(`创建配置失败：${err.message}`)
        this.apiConfigs = defaultConfigs
      }
      return
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf-8')
      this.apiConfigs = JSON.parse(content)
      this.logger.info(`已加载配置：${this.apiConfigs.length}项`)
    } catch (err) {
      this.logger.error(`加载配置失败：${err.message}`)
      this.apiConfigs = defaultConfigs
    }
  }

  /**
   * 注册所有子命令
   */
  registerCommands(meme: Command) {
    // 注册make子命令
    meme.subcommand('.make [type:string] [arg1:string] [arg2:string]', '基于 API 制作 Meme')
      .usage('选择表情类型并输入参数')
      .example('memes make 吃 @用户 - 生成"吃"表情')
      .action(async ({ session }, type, arg1, arg2) => {
        // 查找API索引
        const index = !type
          ? Math.floor(Math.random() * this.apiConfigs.length)
          : this.apiConfigs.findIndex(config =>
              config.description.split('|')[0].trim() === type.trim()
            );

        if (index === -1) return `未找到"${type}"表情类型`

        try {
          const config = this.apiConfigs[index];
          const parsedArg1 = parseTargetId(arg1, session.userId)
          const parsedArg2 = parseTargetId(arg2, session.userId)

          // 替换API URL中的占位符
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

          return imageUrl ? h('image', { url: imageUrl }) : '生成失败'
        } catch (err) {
          this.logger.error(`API请求失败: ${err.message}`)
          return '生成出错：' + err.message
        }
      })

    // 注册api子命令
    meme.subcommand('.api [page:string]', '列出表情列表')
      .usage('使用"all"显示全部，或输入数字查看指定页码')
      .action(({}, page) => {
        const ITEMS_PER_PAGE = 10
        const showAll = page === 'all'
        const pageNum = typeof page === 'string' ? parseInt(page) || 1 : (page || 1)

        // 提取和格式化表情描述
        const typeDescriptions = this.apiConfigs.map(config => config.description)
        const lines = []
        let currentLine = ''
        let currentWidth = 0
        const MAX_WIDTH = 36
        const SEPARATOR = ' '

        // 计算宽度和格式化为多行
        for (const description of typeDescriptions) {
          // 计算字符宽度
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

        // 添加最后一行
        if (currentLine.length > 0) {
          lines.push(currentLine)
        }

        // 准备显示
        const totalPages = Math.ceil(lines.length / ITEMS_PER_PAGE)
        const validPage = Math.max(1, Math.min(pageNum, showAll ? 1 : totalPages))
        const displayLines = showAll
          ? lines
          : lines.slice((validPage - 1) * ITEMS_PER_PAGE, validPage * ITEMS_PER_PAGE)

        // 构建页面头部
        const header = showAll
          ? `表情列表（共${this.apiConfigs.length}项）\n`
          : totalPages > 1
            ? `表情列表（${validPage}/${totalPages}页）\n`
            : "表情列表\n"

        return header + displayLines.join('\n')
      })

    // 条件注册reload命令
    if (this.enableExternalConfig) {
      meme.subcommand('.reload', '重载 API 配置', { authority: 3 })
        .action(() => {
          try {
            const content = fs.readFileSync(this.configPath, 'utf-8')
            this.apiConfigs = JSON.parse(content)
            return `已重载配置：${this.apiConfigs.length}项`
          } catch (err) {
            return '重载配置失败：' + err.message
          }
        })
    }
  }
}
