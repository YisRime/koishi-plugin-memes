/**
 * 表情包类型配置
 */
export interface EmoticonConfig {
  description: string  // 表情描述
  apiEndpoint: string  // API地址包含参数模板
  needSecondQQ?: boolean  // 是否需要第二个QQ参数
  needText?: boolean  // 是否需要文本参数
}

/**
 * 表情包类型配置列表
 */
export const emoticonTypes: EmoticonConfig[] = [
  {
    description: '好玩',
    apiEndpoint: 'https://api.andeer.top/API/img_interesting.php?qq=${qq}'
  },
  {
    description: '吸',
    apiEndpoint: 'https://api.andeer.top/API/gif_inhale.php?qq=${qq}'
  },
  {
    description: '脆弱',
    apiEndpoint: 'https://api.andeer.top/API/img_weak.php?qq=${qq}'
  },
  {
    description: '踩',
    apiEndpoint: 'https://api.andeer.top/API/gif_tread.php?qq=${qq}'
  },
  {
    description: '捂脸',
    apiEndpoint: 'https://api.andeer.top/API/img_facepalm.php?qq=${qq}'
  },
  {
    description: '踢',
    apiEndpoint: 'https://api.andeer.top/API/gif_kick.php?qq=${qq}'
  },
  {
    description: '推',
    apiEndpoint: 'https://api.andeer.top/API/gif_push.php?qq=${qq}'
  },
  {
    description: '拍GIF',
    apiEndpoint: 'https://api.andeer.top/API/gif_pat.php?qq=${qq}'
  },
  {
    description: '舔',
    apiEndpoint: 'https://api.andeer.top/API/gif_lick.php?qq=${qq}'
  },
  {
    description: '快逃',
    apiEndpoint: 'https://api.andeer.top/API/gif_escape.php?qq=${qq}'
  },
  {
    description: '弹',
    apiEndpoint: 'https://api.andeer.top/API/gif_bounce.php?qq=${qq}'
  },
  {
    description: '旋转',
    apiEndpoint: 'https://api.andeer.top/API/gif_whirl.php?qq=${qq}'
  },
  {
    description: '赞',
    apiEndpoint: 'https://api.andeer.top/API/gif_praise.php?qq=${qq}'
  },
  {
    description: '敲',
    apiEndpoint: 'https://api.andeer.top/API/gif_knock.php?qq=${qq}'
  },
  {
    description: '敲2',
    apiEndpoint: 'https://api.andeer.top/API/gif_knock2.php?qq=${qq}'
  },
  {
    description: '摸鱼',
    apiEndpoint: 'https://api.andeer.top/API/img_fish.php?qq=${qq}'
  },
  {
    description: '摸鱼GIF',
    apiEndpoint: 'https://api.andeer.top/API/gif_fish.php?qq=${qq}'
  },
  {
    description: '打',
    apiEndpoint: 'https://api.andeer.top/API/gif_hit.php?qq=${qq}'
  },
  {
    description: '仰望大佬',
    apiEndpoint: 'https://api.andeer.top/API/img_look.php?qq=${qq}'
  },
  {
    description: '丢',
    apiEndpoint: 'https://api.andeer.top/API/img_throw.php?qq=${qq}'
  },
  {
    description: '丢GIF',
    apiEndpoint: 'https://api.andeer.top/API/gif_throw.php?qq=${qq}'
  },
  {
    description: '丢2',
    apiEndpoint: 'https://api.andeer.top/API/gif_throw2.php?qq=${qq}'
  },
  {
    description: '吃GIF',
    apiEndpoint: 'https://api.andeer.top/API/gif_eat.php?qq=${qq}'
  },
  {
    description: '吃3',
    apiEndpoint: 'https://api.andeer.top/API/img_eat2.php?qq=${qq}'
  },
  {
    description: '可莉吃',
    apiEndpoint: 'https://api.andeer.top/API/gif_klee_eat.php?qq=${qq}'
  },
  {
    description: '亲亲|双人',
    apiEndpoint: 'https://api.andeer.top/API/img_kiss.php?bqq=${qq}&cqq=${qq2}'
  },
  {
    description: '要亲亲',
    apiEndpoint: 'https://api.andeer.top/API/img_kiss_1.php?qq=${qq}'
  },
  {
    description: '亲亲3',
    apiEndpoint: 'https://api.andeer.top/API/img_kiss_3.php?qq=${qq}'
  },
  {
    description: '米哈游',
    apiEndpoint: 'https://api.andeer.top/API/img_mi.php?qq=${qq}'
  },
  {
    description: '交个朋友',
    apiEndpoint: 'https://api.andeer.top/API/img_makefriend.php?qq=${qq}'
  },
  {
    description: '香草泥',
    apiEndpoint: 'https://api.andeer.top/API/img_xiangcaoni.php?qq=${qq}'
  },
  {
    description: '甘雨爱心',
    apiEndpoint: 'https://api.andeer.top/API/img_love.php?qq=${qq}'
  },
  {
    description: '需要',
    apiEndpoint: 'https://api.andeer.top/API/img_need.php?qq=${qq}'
  },
  {
    description: '捣',
    apiEndpoint: 'https://api.andeer.top/API/gif_dao.php?qq=${qq}'
  },
  {
    description: '捶',
    apiEndpoint: 'https://api.andeer.top/API/gif_thump.php?qq=${qq}'
  },
  {
    description: '听音乐',
    apiEndpoint: 'https://api.andeer.top/API/img_listen_music.php?qq=${qq}'
  },
  {
    description: '掀墙纸',
    apiEndpoint: 'https://api.andeer.top/API/gif_wallpaper.php?qq=${qq}'
  },
  {
    description: '咬',
    apiEndpoint: 'https://api.andeer.top/API/gif_bite.php?qq=${qq}'
  },
  {
    description: '胡桃咬',
    apiEndpoint: 'https://api.andeer.top/API/gif_hutao_bite.php?qq=${qq}'
  },
  {
    description: '崇拜',
    apiEndpoint: 'https://api.andeer.top/API/gif_worship.php?qq=${qq}'
  },
  {
    description: '屏幕',
    apiEndpoint: 'https://api.andeer.top/API/img_screen.php?qq=${qq}'
  },
  {
    description: '推雪球',
    apiEndpoint: 'https://api.andeer.top/API/gif_tui.php?qq=${qq}'
  },
  {
    description: '加载',
    apiEndpoint: 'https://api.andeer.top/API/img_loading.php?qq=${qq}'
  },
  {
    description: '爬',
    apiEndpoint: 'https://api.andeer.top/API/img_crawl.php?qq=${qq}'
  },
  {
    description: '爬2',
    apiEndpoint: 'https://api.andeer.top/API/img_climb.php?qq=${qq}'
  },
  {
    description: '拍',
    apiEndpoint: 'https://api.andeer.top/API/gif_pai.php?qq=${qq}'
  },
  {
    description: '顶',
    apiEndpoint: 'https://api.andeer.top/API/gif_ding.php?qq=${qq}'
  },
  {
    description: '贴贴',
    apiEndpoint: 'https://api.andeer.top/API/gif_tietie.php?qq=${qq}'
  },
  {
    description: '摸摸头',
    apiEndpoint: 'https://api.andeer.top/API/gif_mo.php?qq=${qq}'
  },
  {
    description: '踢人',
    apiEndpoint: 'https://api.andeer.top/API/img_tr.php?qq=${qq}'
  },
  {
    description: '老实点',
    apiEndpoint: 'https://api.andeer.top/API/img_lsd.php?qq=${qq}'
  },
  {
    description: '牵手|双人',
    apiEndpoint: 'https://api.andeer.top/API/img_qian.php?bqq=${qq}&cqq=${qq2}'
  },
  {
    description: '点赞',
    apiEndpoint: 'https://api.andeer.top/API/img_good.php?qq=${qq}'
  },
  {
    description: '想念|双人',
    apiEndpoint: 'https://api.andeer.top/API/img_miss.php?bqq=${qq}&cqq=${qq2}'
  },
  {
    description: '击剑|双人',
    apiEndpoint: 'https://api.andeer.top/API/gif_beat_j.php?bqq=${qq}&cqq=${qq2}'
  },
  {
    description: '朋友说|文字',
    apiEndpoint: 'https://api.andeer.top/API/img_say.php?qq=${qq}&text=${text}'
  },
  {
    description: '可爱',
    apiEndpoint: 'https://api.andeer.top/API/img_cute.php?qq=${qq}'
  },
  {
    description: '为什么艾特',
    apiEndpoint: 'https://api.andeer.top/API/img_whyat.php?qq=${qq}'
  },
  {
    description: '画家',
    apiEndpoint: 'https://api.andeer.top/API/img_painter.php?qq=${qq}'
  },
  {
    description: '蒙娜丽莎',
    apiEndpoint: 'https://api.andeer.top/API/img_mnls.php?qq=${qq}'
  },
  {
    description: '狂热粉|文字',
    apiEndpoint: 'https://api.andeer.top/API/hot_fans.php?text=${text}'
  },
  {
    description: '妻子|双人',
    apiEndpoint: 'https://api.andeer.top/API/img_wife.php?bqq=${qq}&cqq=${qq2}'
  },
  {
    description: '阿妮垭看',
    apiEndpoint: 'https://api.andeer.top/API/aniyasuki.php?qq=${qq}'
  },
  {
    description: '精神涣散',
    apiEndpoint: 'https://api.andeer.top/API/no_attention.php?qq=${qq}'
  },
  {
    description: '拳击',
    apiEndpoint: 'https://api.andeer.top/API/gif_beat.php?qq=${qq}'
  },
  {
    description: '狗',
    apiEndpoint: 'https://api.andeer.top/API/dog.php?qq=${qq}'
  },
  {
    description: '搬砖',
    apiEndpoint: 'https://api.andeer.top/API/banzhuan.php?qq=${qq}'
  },
  {
    description: '悲报|文字',
    apiEndpoint: 'https://api.andeer.top/API/img_beibao.php?data=${text}'
  },
  {
    description: '喜报|文字',
    apiEndpoint: 'https://api.andeer.top/API/img_xibao.php?data=${text}'
  },
  {
    description: '诺基亚文案|文字',
    apiEndpoint: 'https://api.andeer.top/API/img_nokia.php?data=${text}'
  },
  {
    description: '摩擦|双人',
    apiEndpoint: 'https://api.andeer.top/API/moca.php?bqq=${qq}&cqq=${qq2}'
  },
  {
    description: '不幸',
    apiEndpoint: 'https://api.andeer.top/API/un_for.php?qq=${qq}'
  },
  {
    description: '日漫证',
    apiEndpoint: 'https://api.andeer.top/API/jc_badge.php?qq=${qq}'
  },
  {
    description: '抱',
    apiEndpoint: 'https://api.andeer.top/API/bao.php?qq=${qq}'
  },
  {
    description: '猎手',
    apiEndpoint: 'https://api.andeer.top/API/lieshou.php?qq=${qq}'
  },
  {
    description: '猎手2',
    apiEndpoint: 'https://api.andeer.top/API/lieshou2.php?qq=${qq}'
  },
  {
    description: '羡慕',
    apiEndpoint: 'https://api.andeer.top/API/xianmu.php?qq=${qq}'
  },
  {
    description: '单身狗证',
    apiEndpoint: 'https://api.andeer.top/API/dsg.php?qq=${qq}'
  },
  {
    description: '地图头像',
    apiEndpoint: 'https://api.andeer.top/API/dt.php?qq=${qq}'
  },
  {
    description: '举',
    apiEndpoint: 'https://api.andeer.top/API/ju.php?qq=${qq}'
  },
  {
    description: '高质量男性',
    apiEndpoint: 'https://api.andeer.top/API/gzl.php?qq=${qq}'
  }
]
