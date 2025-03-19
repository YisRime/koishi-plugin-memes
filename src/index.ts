import { Context, Schema, h } from 'koishi'
import { emoticonTypes as defTypes } from './emoticontype'
import * as utils from './utils'

export const name = 'memes'

export interface Config {
  loadExternal?: boolean
  memeGeneratorUrl?: string
}

export const Config: Schema<Config> = Schema.object({
  loadExternal: Schema.boolean()
    .description('是否从文件中加载 API 配置').default(true),
  memeGeneratorUrl: Schema.string()
    .description('MemeGenerator API 地址').default('')
})

export function apply(ctx: Context, cfg: Config) {
  // 加载表情类型
  const types = utils.loadConfig(ctx, cfg.loadExternal, defTypes)

  // 注册命令
  const meme = ctx.command('memes [tplId:string] [...texts:text]', '制作 Meme 表情包')
    .usage('使用 MemeGenerator API 生成表情包\n示例: memes drake 不学习 学习')
    .example('memes drake 不用koishi 用koishi - 生成反对/支持模板')
    .example('memes list - 查看可用模板列表')
    .action(async ({ session }, tplId, ...texts) => {
      if (!tplId) {
        return '请提供模板ID和文本参数。使用 memes list 查看可用模板。'
      }

      try {
        const url = await utils.genMeme(cfg.memeGeneratorUrl, tplId, texts, session)
        return h('image', { url })
      } catch (err) {
        utils.log.error(err)
        return `生成失败: ${err.message}`
      }
    })

  meme.subcommand('.list', '列出所有可用的模板')
    .usage('显示 MemeGenerator API 提供的所有模板列表')
    .action(async () => {
      try {
        const tpls = await utils.getTpls(cfg.memeGeneratorUrl)
        if (tpls.length === 0) return '没有可用的模板。'

        return tpls.map(t => `${t.id}: ${t.name} (需要 ${t.text_count} 段文本)`).join('\n')
      } catch (err) {
        return `获取模板列表失败: ${err.message}`
      }
    })

  meme.subcommand('.make [type:string] [arg1:string] [arg2:string]', '使用 API 制作 Meme')
    .usage('选择表情类型，并输入参数生成表情包')
    .example('memes.make 吃 @用户 - 生成"吃"表情')
    .example('memes.make 喜报 文本 - 生成喜报')
    .example('memes.make 牵手 @用户1 @用户2 - 生成双人表情')
    .action(async ({ session }, type, arg1, arg2) => {
      const idx = utils.chooseType(types, type)
      if (idx === -1) return `未找到与"${type}"匹配的表情类型`

      try {
        const url = await utils.genImg(types[idx], arg1, arg2, session)
        return url ? h('image', { url }) : '生成表情包失败'
      } catch (err) {
        return '生成表情包出错：' + err.message
      }
    })

  meme.subcommand('.apilist [page:string]', '显示经典表情包类型列表')
    .usage('使用"all"显示全部表情类型')
    .action(({}, page) => utils.showMenu(types, page || 1))

  meme.subcommand('.apireload', '重新加载配置', { authority: 3 })
    .action(() => {
      try {
        const newTypes = utils.loadConfig(ctx, cfg.loadExternal, defTypes)
        types.length = 0
        newTypes.forEach(t => types.push(t))
        return `已重新加载配置（共${types.length}项）`
      } catch (err) {
        return '重新加载配置失败：' + err.message
      }
    })
}
