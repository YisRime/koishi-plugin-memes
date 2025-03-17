/**
 * 表情包类型配置
 */
export interface EmoticonConfig {
  description: string  // 表情描述(支持|分隔多别名)
  apiEndpoint: string  // API地址包含参数模板
}

/**
 * 表情包类型配置列表
 * 这是默认的表情包配置，会在首次启动时写入data目录
 */
export const emoticonTypes: EmoticonConfig[] = [
  {
    description: '好玩',
    apiEndpoint: 'https://api.andeer.top/API/img_interesting.php?qq=${arg1}'
  },
  {
    description: '吸',
    apiEndpoint: 'https://api.andeer.top/API/gif_inhale.php?qq=${arg1}'
  },
  {
    description: '脆弱',
    apiEndpoint: 'https://api.andeer.top/API/img_weak.php?qq=${arg1}'
  },
  {
    description: '踩',
    apiEndpoint: 'https://api.andeer.top/API/gif_tread.php?qq=${arg1}'
  },
  {
    description: '捂脸',
    apiEndpoint: 'https://api.andeer.top/API/img_facepalm.php?qq=${arg1}'
  },
  {
    description: '踢',
    apiEndpoint: 'https://api.andeer.top/API/gif_kick.php?qq=${arg1}'
  },
  {
    description: '推',
    apiEndpoint: 'https://api.andeer.top/API/gif_push.php?qq=${arg1}'
  },
  {
    description: '拍GIF',
    apiEndpoint: 'https://api.andeer.top/API/gif_pat.php?qq=${arg1}'
  },
  {
    description: '舔',
    apiEndpoint: 'https://api.andeer.top/API/gif_lick.php?qq=${arg1}'
  },
  {
    description: '快逃',
    apiEndpoint: 'https://api.andeer.top/API/gif_escape.php?qq=${arg1}'
  },
  {
    description: '弹',
    apiEndpoint: 'https://api.andeer.top/API/gif_bounce.php?qq=${arg1}'
  },
  {
    description: '旋转',
    apiEndpoint: 'https://api.andeer.top/API/gif_whirl.php?qq=${arg1}'
  },
  {
    description: '赞',
    apiEndpoint: 'https://api.andeer.top/API/gif_praise.php?qq=${arg1}'
  },
  {
    description: '敲',
    apiEndpoint: 'https://api.andeer.top/API/gif_knock.php?qq=${arg1}'
  },
  {
    description: '敲2',
    apiEndpoint: 'https://api.andeer.top/API/gif_knock2.php?qq=${arg1}'
  },
  {
    description: '摸鱼',
    apiEndpoint: 'https://api.andeer.top/API/img_fish.php?qq=${arg1}'
  },
  {
    description: '摸鱼GIF',
    apiEndpoint: 'https://api.andeer.top/API/gif_fish.php?qq=${arg1}'
  },
  {
    description: '打',
    apiEndpoint: 'https://api.andeer.top/API/gif_hit.php?qq=${arg1}'
  },
  {
    description: '仰望大佬',
    apiEndpoint: 'https://api.andeer.top/API/img_look.php?qq=${arg1}'
  },
  {
    description: '丢',
    apiEndpoint: 'https://api.andeer.top/API/img_throw.php?qq=${arg1}'
  },
  {
    description: '丢GIF',
    apiEndpoint: 'https://api.andeer.top/API/gif_throw.php?qq=${arg1}'
  },
  {
    description: '丢2',
    apiEndpoint: 'https://api.andeer.top/API/gif_throw2.php?qq=${arg1}'
  },
  {
    description: '吃GIF',
    apiEndpoint: 'https://api.andeer.top/API/gif_eat.php?qq=${arg1}'
  },
  {
    description: '吃3',
    apiEndpoint: 'https://api.andeer.top/API/img_eat2.php?qq=${arg1}'
  },
  {
    description: '可莉吃',
    apiEndpoint: 'https://api.andeer.top/API/gif_klee_eat.php?qq=${arg1}'
  },
  {
    description: '亲亲|双人',
    apiEndpoint: 'https://api.andeer.top/API/img_kiss.php?bqq=${arg1}&cqq=${arg2}'
  },
  {
    description: '要亲亲',
    apiEndpoint: 'https://api.andeer.top/API/img_kiss_1.php?qq=${arg1}'
  },
  {
    description: '亲亲3',
    apiEndpoint: 'https://api.andeer.top/API/img_kiss_3.php?qq=${arg1}'
  },
  {
    description: '米哈游',
    apiEndpoint: 'https://api.andeer.top/API/img_mi.php?qq=${arg1}'
  },
  {
    description: '交个朋友',
    apiEndpoint: 'https://api.andeer.top/API/img_makefriend.php?qq=${arg1}'
  },
  {
    description: '香草泥',
    apiEndpoint: 'https://api.andeer.top/API/img_xiangcaoni.php?qq=${arg1}'
  },
  {
    description: '甘雨爱心',
    apiEndpoint: 'https://api.andeer.top/API/img_love.php?qq=${arg1}'
  },
  {
    description: '需要',
    apiEndpoint: 'https://api.andeer.top/API/img_need.php?qq=${arg1}'
  },
  {
    description: '捣',
    apiEndpoint: 'https://api.andeer.top/API/gif_dao.php?qq=${arg1}'
  },
  {
    description: '捶',
    apiEndpoint: 'https://api.andeer.top/API/gif_thump.php?qq=${arg1}'
  },
  {
    description: '听音乐',
    apiEndpoint: 'https://api.andeer.top/API/img_listen_music.php?qq=${arg1}'
  },
  {
    description: '掀墙纸',
    apiEndpoint: 'https://api.andeer.top/API/gif_wallpaper.php?qq=${arg1}'
  },
  {
    description: '咬',
    apiEndpoint: 'https://api.andeer.top/API/gif_bite.php?qq=${arg1}'
  },
  {
    description: '胡桃咬',
    apiEndpoint: 'https://api.andeer.top/API/gif_hutao_bite.php?qq=${arg1}'
  },
  {
    description: '崇拜',
    apiEndpoint: 'https://api.andeer.top/API/gif_worship.php?qq=${arg1}'
  },
  {
    description: '屏幕',
    apiEndpoint: 'https://api.andeer.top/API/img_screen.php?qq=${arg1}'
  },
  {
    description: '推雪球',
    apiEndpoint: 'https://api.andeer.top/API/gif_tui.php?qq=${arg1}'
  },
  {
    description: '加载',
    apiEndpoint: 'https://api.andeer.top/API/img_loading.php?qq=${arg1}'
  },
  {
    description: '爬',
    apiEndpoint: 'https://api.andeer.top/API/img_crawl.php?qq=${arg1}'
  },
  {
    description: '爬2',
    apiEndpoint: 'https://api.andeer.top/API/img_climb.php?qq=${arg1}'
  },
  {
    description: '拍',
    apiEndpoint: 'https://api.andeer.top/API/gif_pai.php?qq=${arg1}'
  },
  {
    description: '顶',
    apiEndpoint: 'https://api.andeer.top/API/gif_ding.php?qq=${arg1}'
  },
  {
    description: '贴贴',
    apiEndpoint: 'https://api.andeer.top/API/gif_tietie.php?qq=${arg1}'
  },
  {
    description: '摸摸头',
    apiEndpoint: 'https://api.andeer.top/API/gif_mo.php?qq=${arg1}'
  },
  {
    description: '踢人',
    apiEndpoint: 'https://api.andeer.top/API/img_tr.php?qq=${arg1}'
  },
  {
    description: '老实点',
    apiEndpoint: 'https://api.andeer.top/API/img_lsd.php?qq=${arg1}'
  },
  {
    description: '牵手|双人',
    apiEndpoint: 'https://api.andeer.top/API/img_qian.php?bqq=${arg1}&cqq=${arg2}'
  },
  {
    description: '点赞',
    apiEndpoint: 'https://api.andeer.top/API/img_good.php?qq=${arg1}'
  },
  {
    description: '想念|双人',
    apiEndpoint: 'https://api.andeer.top/API/img_miss.php?bqq=${arg1}&cqq=${arg2}'
  },
  {
    description: '击剑|双人',
    apiEndpoint: 'https://api.andeer.top/API/gif_beat_j.php?bqq=${arg1}&cqq=${arg2}'
  },
  {
    description: '朋友说|文字',
    apiEndpoint: 'https://api.andeer.top/API/img_say.php?qq=${arg1}&text=${arg2}'
  },
  {
    description: '可爱',
    apiEndpoint: 'https://api.andeer.top/API/img_cute.php?qq=${arg1}'
  },
  {
    description: '为什么艾特',
    apiEndpoint: 'https://api.andeer.top/API/img_whyat.php?qq=${arg1}'
  },
  {
    description: '画家',
    apiEndpoint: 'https://api.andeer.top/API/img_painter.php?qq=${arg1}'
  },
  {
    description: '蒙娜丽莎',
    apiEndpoint: 'https://api.andeer.top/API/img_mnls.php?qq=${arg1}'
  },
  {
    description: '狂热粉|文字',
    apiEndpoint: 'https://api.andeer.top/API/hot_fans.php?text=${arg1}'
  },
  {
    description: '妻子|双人',
    apiEndpoint: 'https://api.andeer.top/API/img_wife.php?bqq=${arg1}&cqq=${arg2}'
  },
  {
    description: '阿妮垭看',
    apiEndpoint: 'https://api.andeer.top/API/aniyasuki.php?qq=${arg1}'
  },
  {
    description: '精神涣散',
    apiEndpoint: 'https://api.andeer.top/API/no_attention.php?qq=${arg1}'
  },
  {
    description: '拳击',
    apiEndpoint: 'https://api.andeer.top/API/gif_beat.php?qq=${arg1}'
  },
  {
    description: '狗',
    apiEndpoint: 'https://api.andeer.top/API/dog.php?qq=${arg1}'
  },
  {
    description: '搬砖',
    apiEndpoint: 'https://api.andeer.top/API/banzhuan.php?qq=${arg1}'
  },
  {
    description: '悲报|文字',
    apiEndpoint: 'https://api.andeer.top/API/img_beibao.php?data=${arg1}'
  },
  {
    description: '喜报|文字',
    apiEndpoint: 'https://api.andeer.top/API/img_xibao.php?data=${arg1}'
  },
  {
    description: '诺基亚文案|文字',
    apiEndpoint: 'https://api.andeer.top/API/img_nokia.php?data=${arg1}'
  },
  {
    description: '摩擦|双人',
    apiEndpoint: 'https://api.andeer.top/API/moca.php?bqq=${arg1}&cqq=${arg2}'
  },
  {
    description: '不幸',
    apiEndpoint: 'https://api.andeer.top/API/un_for.php?qq=${arg1}'
  },
  {
    description: '日漫证',
    apiEndpoint: 'https://api.andeer.top/API/jc_badge.php?qq=${arg1}'
  },
  {
    description: '抱',
    apiEndpoint: 'https://api.andeer.top/API/bao.php?qq=${arg1}'
  },
  {
    description: '猎手',
    apiEndpoint: 'https://api.andeer.top/API/lieshou.php?qq=${arg1}'
  },
  {
    description: '猎手2',
    apiEndpoint: 'https://api.andeer.top/API/lieshou2.php?qq=${arg1}'
  },
  {
    description: '羡慕',
    apiEndpoint: 'https://api.andeer.top/API/xianmu.php?qq=${arg1}'
  },
  {
    description: '单身狗证',
    apiEndpoint: 'https://api.andeer.top/API/dsg.php?qq=${arg1}'
  },
  {
    description: '地图头像',
    apiEndpoint: 'https://api.andeer.top/API/dt.php?qq=${arg1}'
  },
  {
    description: '举',
    apiEndpoint: 'https://api.andeer.top/API/ju.php?qq=${arg1}'
  },
  {
    description: '高质量男性',
    apiEndpoint: 'https://api.andeer.top/API/gzl.php?qq=${arg1}'
  }
]
