import { Context, h, Command } from 'koishi'
import { parseTarget, getUserAvatar, autoRecall } from './utils'
import path from 'path'
import fs from 'fs'

/**
 * 表情生成器类 - 处理各种图片生成功能
 * @class MemeMaker
 */
export class MemeMaker {
  private ctx: Context

  /**
   * 图片配置参数
   * @private
   * @readonly
   * @property {Object} sizes - 不同尺寸配置
   * @property {Object} styles - 不同样式配置
   */
  private readonly IMAGE_CONFIG = {
    sizes: {
      standard: { width: 1280, height: 720 },
      square: { width: 800, height: 800 },
      small: { width: 640, height: 360 }
    },
    styles: {
      jiazi: { background: 'PCL-Jiazi.jpg', avatarSize: 400, avatarTop: 60, borderRadius: 8 },
      tntboom: { background: 'HMCL-Boom.jpg', avatarSize: 320, avatarTop: 20, borderRadius: 8 },
      zhuo: { background: 'PCLCE-Zhuo.jpg', avatarSize: 400, avatarTop: 60, borderRadius: 8 }
    }
  };

  /**
   * 创建表情生成器实例
   * @constructor
   * @param {Context} ctx - Koishi 上下文实例
   */
  constructor(ctx: Context) {
    this.ctx = ctx
    Object.keys(this.IMAGE_CONFIG.styles).forEach(key => {
      this.IMAGE_CONFIG.styles[key].background = path.resolve(__dirname, './assets', this.IMAGE_CONFIG.styles[key].background)
    })
  }

  /**
   * 将HTML内容渲染为图片
   * @async
   * @param {string} html - 要渲染的HTML内容
   * @param {Object} options - 渲染选项
   * @param {number} [options.width] - 图片宽度
   * @param {number} [options.height] - 图片高度
   * @returns {Promise<Buffer>} 生成的图片Buffer
   * @throws {Error} 渲染过程中的错误
   */
  async htmlToImage(html: string, { width, height }: { width?: number; height?: number } = {}): Promise<Buffer> {
    const page = await this.ctx.puppeteer.page()
    try {
      await page.setViewport({ width, height, deviceScaleFactor: 2.0 })
      await page.setContent(
        `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;padding:0;overflow:hidden;}</style></head><body>${html}</body></html>`,
        { waitUntil: 'networkidle0' }
      )
      await page.evaluate(() => Promise.all(
        Array.from(document.querySelectorAll('img')).map(img =>
          img.complete ? Promise.resolve() : new Promise(resolve => {
            img.addEventListener('load', resolve);
            img.addEventListener('error', resolve);
          })
        )
      ))
      return await page.screenshot({ type: 'png', fullPage: false })
    } finally {
      await page.close()
    }
  }

  /**
   * 生成头像效果合成图
   * @async
   * @param {string} avatarUrl - 头像URL或本地文件路径
   * @param {string} style - 使用的样式名称
   * @returns {Promise<Buffer>} 生成的图片Buffer
   * @throws {Error} 生成过程中的错误
   */
  async generateAvatarEffect(avatarUrl: string, style: string): Promise<Buffer> {
    const styleConfig = this.IMAGE_CONFIG.styles[style] || this.IMAGE_CONFIG.styles.jiazi;
    const sizeConfig = this.IMAGE_CONFIG.sizes.standard;
    const getImageSrc = (url: string) => {
      if (url?.startsWith('http')) return url;
      const filePath = url?.replace('file://', '');
      return filePath && fs.existsSync(filePath) ?
        `data:image/jpeg;base64,${fs.readFileSync(filePath).toString('base64')}` : null;
    };
    const avatarImageSrc = getImageSrc(avatarUrl);
    const backgroundImage = getImageSrc(`file://${styleConfig.background}`);
    const html = `
      <div style="width:${sizeConfig.width}px;height:${sizeConfig.height}px;position:relative;margin:0;padding:0;overflow:hidden;">
        <img style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;" src="${backgroundImage}" />
        ${avatarImageSrc ? `<img style="position:absolute;top:${styleConfig.avatarTop}px;left:50%;transform:translateX(-50%);
         width:${styleConfig.avatarSize}px;height:${styleConfig.avatarSize}px;object-fit:cover;
         z-index:2;border-radius:${styleConfig.borderRadius}px;box-shadow:0 5px 15px rgba(0,0,0,0.3);"
         src="${avatarImageSrc}" />` : ''}
      </div>`;
    return this.htmlToImage(html, sizeConfig);
  }

  /**
   * 注册表情生成相关命令
   * @param {Command} parentCommand - 父命令实例
   * @returns {Command} 创建的子命令
   */
  registerCommands(parentCommand: Command): Command {
    const make = parentCommand.subcommand('make', '内置图片表情生成')
      .usage('使用内置模板生成表情图片')
    const descriptions = {
      jiazi: '生成"你要被夹"图片',
      tntboom: '生成"你要被炸"图片',
      zhuo: '生成"你要被捉"图片',
    };
    Object.keys(this.IMAGE_CONFIG.styles).forEach(style => {
      make.subcommand(`.${style} [target:text]`, descriptions[style])
        .usage(`根据用户头像生成${descriptions[style] || style}\n不指定用户时使用自己的头像`)
        .example(`make.${style} @用户 - 使用@用户的头像生成图片`)
        .example(`make.${style} 123456789 - 使用指定QQ号生成图片`)
        .action(async ({ session }, target) => {
          try {
            const userId = target ? parseTarget(target) || session.userId : session.userId;
            const avatar = await getUserAvatar(session, userId);
            const result = await this.generateAvatarEffect(avatar, style);
            return h.image(result, 'image/png');
          } catch (error) {
           return autoRecall(session, '生成出错：' + error.message);
          }
        });
    });
    return make;
  }
}
