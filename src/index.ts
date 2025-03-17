import { Context, Schema, h } from 'koishi'
import axios from 'axios'
import { emoticonTypes } from './emoticontype'

export const name = 'memes'
export interface Config {}
export const Config: Schema<Config> = Schema.object({})

/**
 * 解析目标用户ID (支持@元素、@数字格式或纯数字)
 * @param target - 要解析的目标字符串，可以是纯数字、`@`元素或`@`数字格式
 * @returns 解析出的用户ID，如果解析失败则返回null
 */
function parseTarget(target: string): string | null {
  if (!target) return null
  // 尝试解析at元素
  try {
    const atElement = h.select(h.parse(target), 'at')[0]
    if (atElement?.attrs?.id) return atElement.attrs.id;
  } catch {}
  // 尝试匹配@数字格式或纯数字
  const atMatch = target.match(/@(\d+)/)
  const userId = atMatch ? atMatch[1] : (/^\d+$/.test(target.trim()) ? target.trim() : null);
  // 验证ID格式：5-10位数字
  return userId && /^\d{5,10}$/.test(userId) ? userId : null;
}

/**
 * 计算字符串实际显示宽度（中文/全角字符占2个宽度）
 */
function getStringWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    if (/[\u4e00-\u9fa5]|[^\x00-\xff]/.test(char)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
* 显示表情包类型菜单
*/
function showMenu(): string {
  const ROW_WIDTH = 36;

  let menu = '使用memes 表情类型 @用户 生成Meme\n';
  let currentRow = [];
  let currentWidth = 0;

  emoticonTypes.forEach((type) => {
    const item = type.description;
    const itemWidth = getStringWidth(item);

    // 如果当前行放不下这个项目，先输出当前行
    if (currentWidth + itemWidth + (currentRow.length > 0 ? 2 : 0) > ROW_WIDTH && currentRow.length > 0) {
      menu += currentRow.join('  ') + '\n';
      currentRow = [];
      currentWidth = 0;
    }

    currentRow.push(item);
    currentWidth += itemWidth + (currentRow.length > 1 ? 2 : 0);

    // 如果是最后一个项目，确保输出
    if (currentRow.length > 0 && type === emoticonTypes[emoticonTypes.length - 1]) {
      menu += currentRow.join('  ') + '\n';
    }
  });

  return menu;
}

/**
 * 搜索表情包类型
 * @param keyword 关键词
 * @returns 匹配的表情类型索引，如果没找到返回-1
 */
function searchEmoticonType(keyword: string): number {
  if (!keyword) return -1;

  // 尝试通过描述精确匹配
  const exactMatch = emoticonTypes.findIndex(
    type => type.description === keyword
  );
  if (exactMatch !== -1) return exactMatch;

  // 尝试通过包含关系匹配
  const partialMatch = emoticonTypes.findIndex(
    type => type.description.includes(keyword)
  );
  return partialMatch;
}

/**
 * 生成表情包图片
 */
async function generateImage(
  config: { apiEndpoint: string },
  params: { qq: string, qq2: string, text: string }
): Promise<string> {
  try {
    let url = config.apiEndpoint;
    if (params.qq) {
      url = url.replace(/\${qq}/g, params.qq);
    }
    if (params.qq2) {
      url = url.replace(/\${qq2}/g, params.qq2);
    }
    if (params.text) {
      url = url.replace(/\${text}/g, encodeURIComponent(params.text));
    }

    const response = await axios.get(url, {
      timeout: 8000,
      validateStatus: () => true,
      responseType: 'text'
    });
    if (response.headers['content-type']?.includes('application/json')) {
      try {
        const jsonData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        return jsonData?.code === 200 ? jsonData.data : null;
      } catch (e) {
        return url;
      }
    } else {
      return url;
    }
  } catch (error) {
    throw new Error('API请求失败: ' + error.message);
  }
}

export function apply(ctx: Context) {

  const logger = ctx.logger('memes')

  ctx.command('memes [type:text] [target:string] [extra:text]', '制作 Meme 表情包')
    .usage('选择表情类型，并输入相关参数，生成 Meme')
    .example('memes - 显示使用帮助')
    .example('memes 吃 @用户 - 生成"吃"表情')
    .example('memes 喜报 今天是周末 - 生成带文字的表情')
    .action(async ({ session }, type, target, extra) => {
      // 没有参数时显示帮助
      if (!type) {
        return '请输入表情类型或描述，例如：memes 吃 @用户\n查看所有表情类型请使用：memes.list';
      }

      // 搜索匹配的表情类型
      const typeIndex = searchEmoticonType(type);
      if (typeIndex === -1) {
        return `未找到匹配的表情类型"${type}"，请使用 memes.list 查看所有可用表情`;
      }

      try {
        // 获取当前表情配置
        const config = emoticonTypes[typeIndex];
        const apiUrl = config.apiEndpoint;
        // 确定API需要的参数类型
        const needsQQ = apiUrl.includes('${qq}');
        const needsQQ2 = apiUrl.includes('${qq2}');
        const needsText = apiUrl.includes('${text}');
        const isTextOnly = !needsQQ && !needsQQ2 && needsText;
        // 根据不同情况收集参数
        let params = {
          qq: null,
          qq2: null,
          text: null
        };
        if (isTextOnly) {
          // 纯文本API
          params.text = [target, extra].filter(Boolean).join(' ') || '测试文本';
        } else if (needsQQ) {
          // 需要QQ号的API
          params.qq = target ? parseTarget(target) : session.userId;
          if (!params.qq) return '请提供有效用户';
          if (needsQQ2 && extra) {
            params.qq2 = parseTarget(extra) || params.qq;
          } else if (needsText) {
            // 如果需要文本，使用extra作为文本
            params.text = extra || '测试文本';
          }
          // 回退第一个qq
          if (needsQQ2 && !params.qq2) {
            params.qq2 = params.qq;
          }
        }
        // 生成并发送图片
        const imageUrl = await generateImage(config, params);
        return imageUrl ? h('image', { url: imageUrl }) : '生成表情包失败';
      } catch (error) {
        logger.error(error);
        return '生成表情包出错';
      }
    });

  // 添加子命令 memes.list 显示完整菜单
  ctx.command('memes.list', '显示所有可用的表情包类型')
    .action(() => {
      return showMenu();
    });
}
