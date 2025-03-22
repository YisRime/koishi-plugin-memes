import { Context, h, Logger, Command } from 'koishi'
import {} from 'koishi-plugin-puppeteer'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

/**
 * 头像叠加配置选项
 */
export interface OverlayOptions {
  size?: number
  top?: number
  background?: string
}

/**
 * 表情生成器类 - 处理各种图片生成功能
 */
export class MemeMaker {
  private ctx: Context
  private logger: Logger

  // 定义插件资源路径
  private readonly ASSETS_DIR = path.resolve(__dirname, './assets')

  // 图片处理相关常量
  private readonly IMAGE_CONFIG = {
    sizes: {
      standard: { width: 1280, height: 720 },
      square: { width: 800, height: 800 },
      small: { width: 640, height: 360 }
    },
    styles: {
      jiazi: {
        background: 'PCL-Jiazi.jpg',
        avatarSize: 400,
        avatarTop: 60,
        borderRadius: 8
      },
      tntboom: {
        background: 'HMCL-Boom.jpg',
        avatarSize: 320,
        avatarTop: 20,
        avatarOffsetX: 50,
        borderRadius: 8
      }
    }
  };

  /**
   * 创建表情生成器实例
   */
  constructor(ctx: Context, logger: Logger) {
    this.ctx = ctx
    this.logger = logger

    // 确保图像风格的背景路径完整
    for (const key in this.IMAGE_CONFIG.styles) {
      const style = this.IMAGE_CONFIG.styles[key]
      style.background = path.resolve(this.ASSETS_DIR, style.background)
    }
  }

  /**
   * 将HTML内容渲染为图片
   */
  async htmlToImage(html: string, options: { width?: number; height?: number } = {}): Promise<Buffer> {
    const page = await this.ctx.puppeteer.page()
    try {
      await page.setViewport({
        width: options.width,
        height: options.height,
        deviceScaleFactor: 2.0
      })

      await page.setContent(`
        <!DOCTYPE html>
        <html><head><meta charset="UTF-8">
        <style>body{margin:0;padding:0;overflow:hidden;}</style>
        </head><body>${html}</body></html>
      `, { waitUntil: 'networkidle0' })

      // 等待图片加载完成
      await page.evaluate(() => Promise.all(
        Array.from(document.querySelectorAll('img')).map(img => {
          if (img.complete) return Promise.resolve();
          return new Promise(resolve => {
            img.addEventListener('load', resolve);
            img.addEventListener('error', resolve);
          });
        })
      ));

      return await page.screenshot({ type: 'png', fullPage: false })
    } catch (error) {
      this.logger.error('图片渲染出错:', error)
      throw new Error('生成图片时遇到问题，请稍后重试')
    } finally {
      await page.close()
    }
  }

  /**
   * 将图片资源转为base64数据URL
   */
  private imageToDataUrl(imagePath: string): string {
    if (imagePath.startsWith('file://')) {
      const filePath = imagePath.replace('file://', '');
      try {
        if (existsSync(filePath)) {
          return `data:image/jpeg;base64,${readFileSync(filePath).toString('base64')}`;
        }
      } catch (err) {
        this.logger.warn(`读取图片失败: ${filePath}`, err)
      }
    }
    // 非文件路径或读取失败时，直接返回原路径或透明图像
    return imagePath.startsWith('http') ? imagePath :
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  }

  /**
   * 生成头像效果合成图
   */
  async generateAvatarEffect(
    avatarUrl: string,
    style: string
  ): Promise<Buffer> {
    const styleConfig = this.IMAGE_CONFIG.styles[style] || this.IMAGE_CONFIG.styles.jiazi;
    const sizeConfig = this.IMAGE_CONFIG.sizes.standard;

    const avatarImageSrc = this.imageToDataUrl(avatarUrl);
    const backgroundImage = this.imageToDataUrl(`file://${styleConfig.background}`);

    const horizontalPosition = styleConfig.avatarOffsetX
      ? `left: calc(50% + ${styleConfig.avatarOffsetX}px); transform: translateX(-50%);`
      : `left: 50%; transform: translateX(-50%);`;

    const borderRadius = `${styleConfig.borderRadius}px`;

    const html = `
      <div style="width:${sizeConfig.width}px;height:${sizeConfig.height}px;position:relative;margin:0;padding:0;overflow:hidden;">
        <img style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;" src="${backgroundImage}" />
        <img style="position:absolute;top:${styleConfig.avatarTop}px;${horizontalPosition}width:${styleConfig.avatarSize}px;height:${styleConfig.avatarSize}px;object-fit:cover;z-index:2;border-radius:${borderRadius};box-shadow:0 5px 15px rgba(0,0,0,0.3);" src="${avatarImageSrc}" />
      </div>
    `;

    return await this.htmlToImage(html, sizeConfig);
  }

  /**
   * 获取用户头像
   */
  async getUserAvatar(session, userId: string): Promise<string> {
    // 优先使用会话用户自己的头像
    if (userId === session.userId && session.user?.avatar) {
      return session.user.avatar;
    }

    // 尝试从机器人API获取用户头像
    if (session.bot) {
      try {
        const user = await session.bot.getUser(userId);
        if (user?.avatar) return user.avatar;
      } catch (err) {
        this.logger.debug(`获取用户头像失败: ${userId}`, err)
      }
    }

    // 默认返回QQ头像
    return `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`;
  }

  /**
   * 解析目标用户ID
   */
  parseTarget(target: string): string | null {
    if (!target) return null;

    // 尝试解析at元素
    try {
      const atElement = h.select(h.parse(target), 'at')[0];
      if (atElement?.attrs?.id) return atElement.attrs.id;
    } catch {}

    // 尝试匹配@数字或纯数字格式
    const atMatch = target.match(/@(\d+)/);
    const userId = atMatch ? atMatch[1] : (/^\d+$/.test(target.trim()) ? target.trim() : null);

    return userId && /^\d{5,10}$/.test(userId) ? userId : null;
  }

  /**
   * 注册表情生成相关命令
   */
  registerCommands(parentCommand: Command): Command {
    const make = parentCommand.subcommand('.make', '制作特定样式的图片表情');

    // 通用的头像处理函数
    const handleAvatarCommand = async (session, target, style, options = {}) => {
      const userId = target ? this.parseTarget(target) || session.userId : session.userId;
      if (!userId) return '请指定一个有效的用户';

      try {
        const avatar = await this.getUserAvatar(session, userId);
        const result = await this.generateAvatarEffect(avatar, style);
        return h.image(result, 'image/png');
      } catch (error) {
        this.logger.error(`处理头像时出错`, error);
        return '处理头像时出错：' + error.message;
      }
    };

    // 注册子命令
    const registerStyle = (name, description) => {
      make.subcommand(`.${name} [target:text]`, description)
        .action((params, target) => handleAvatarCommand(params.session, target, name, params.options));
    };

    // 注册所有支持的样式
    Object.keys(this.IMAGE_CONFIG.styles).forEach(style => {
      const descriptions = {
        jiazi: '生成"你要被夹"表情包',
        tntboom: '生成"你要被炸"表情包',
      };

      registerStyle(style, descriptions[style] || `生成${style}风格表情`);
    });

    return make;
  }
}
