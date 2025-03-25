import { Context, h, Command } from 'koishi'
import { MemeGenerator } from './generator'
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
  private generator: MemeGenerator
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
        borderRadius: 8
      }
    }
  };

  /**
   * 创建表情生成器实例
   */
  constructor(ctx: Context, generator: MemeGenerator) {
    this.ctx = ctx
    this.generator = generator
    // 确保背景路径完整
    for (const key in this.IMAGE_CONFIG.styles) {
      const style = this.IMAGE_CONFIG.styles[key]
      style.background = path.resolve(__dirname, './assets', style.background)
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
      throw new Error('图片渲染出错:' + error.message)
    } finally {
      await page.close()
    }
  }

  /**
   * 将图片资源转为base64数据URL
   */
  private imageToDataUrl(imagePath: string): string | null {
    const filePath = imagePath.replace('file://', '');
    if (existsSync(filePath)) {
      return `data:image/jpeg;base64,${readFileSync(filePath).toString('base64')}`;
    }
    return imagePath.startsWith('http') ? imagePath : null;
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
    // 头像不存在时，仅显示背景
    const avatarHtml = avatarImageSrc
      ? `<img style="position:absolute;top:${styleConfig.avatarTop}px;left:50%;transform:translateX(-50%);width:${styleConfig.avatarSize}px;height:${styleConfig.avatarSize}px;object-fit:cover;z-index:2;border-radius:${styleConfig.borderRadius}px;box-shadow:0 5px 15px rgba(0,0,0,0.3);" src="${avatarImageSrc}" />`
      : '';
    const html = `
      <div style="width:${sizeConfig.width}px;height:${sizeConfig.height}px;position:relative;margin:0;padding:0;overflow:hidden;">
        <img style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;" src="${backgroundImage}" />
        ${avatarHtml}
      </div>`;
    return await this.htmlToImage(html, sizeConfig);
  }

  /**
   * 注册表情生成相关命令
   */
  registerCommands(parentCommand: Command): Command {
    const make = parentCommand.subcommand('.make', '生成内置表情图片')
      .usage('生成各种预设的表情图片')
      .example('memes.make.jiazi @用户 - 使用指定用户头像生成"你要被夹"图片');

    const registerStyle = (name, description) => {
      make.subcommand(`.${name} [target:text]`, description)
        .usage(`根据用户头像生成${description}`)
        .example(`memes.make.${name} @用户 - 使用指定用户头像生成图片`)
        .example(`memes.make.${name} 123456789 - 使用QQ号生成图片`)
        .action(async (params, target) => {
          const session = params.session;
          const userId = target ? this.generator.parseTarget(target) || session.userId : session.userId;
          try {
            const avatar = await this.generator.getUserAvatar(session, userId);
            const result = await this.generateAvatarEffect(avatar, name);
            return h.image(result, 'image/png');
          } catch (error) {
            return this.generator.autoRecall(session, '生成出错：' + error.message);
          }
        });
    };
    // 注册样式
    Object.keys(this.IMAGE_CONFIG.styles).forEach(style => {
      const descriptions = {
        jiazi: '生成"你要被夹"图片',
        tntboom: '生成"你要被炸"图片',
      };
      registerStyle(style, descriptions[style]);
    });
    return make;
  }
}
