import type { CuratedSourceSeed } from './types';

/**
 * Versioned snapshot of the 204 feeds supplied in feeds-zh.opml.
 * Source identity comes from title/category; feedProvider is classified separately.
 */
export const CURATED_SOURCE_SEEDS = [
  {
    title: "喷嚏图卦",
    feedUrl: "https://plink.anyfeeder.com/pentitugua",
    originalCategory: "新闻",
  },
  {
    title: "iDaily 每日环球视野",
    feedUrl: "https://plink.anyfeeder.com/idaily/today",
    originalCategory: "新闻",
  },
  {
    title: "抽屉新热榜",
    feedUrl: "https://plink.anyfeeder.com/chouti/hot",
    originalCategory: "新闻",
  },
  {
    title: "求是网",
    feedUrl: "https://plink.anyfeeder.com/qstheory",
    originalCategory: "新闻",
  },
  {
    title: "网易新闻 / 今日关注",
    feedUrl: "https://plink.anyfeeder.com/netease/today",
    originalCategory: "新闻",
  },
  {
    title: "新华网 / 新华社新闻",
    feedUrl: "https://plink.anyfeeder.com/newscn/whxw",
    originalCategory: "新闻",
  },
  {
    title: "联合早报 / 中国",
    feedUrl: "https://plink.anyfeeder.com/zaobao/realtime/china",
    originalCategory: "新闻",
  },
  {
    title: "联合早报 / 国际",
    feedUrl: "https://plink.anyfeeder.com/zaobao/realtime/world",
    originalCategory: "新闻",
  },
  {
    title: "南方周末 / 新闻",
    feedUrl: "https://plink.anyfeeder.com/infzm/news",
    originalCategory: "新闻",
  },
  {
    title: "南方周末 / 推荐",
    feedUrl: "https://plink.anyfeeder.com/infzm/recommends",
    originalCategory: "新闻",
  },
  {
    title: "澎湃新闻",
    feedUrl: "https://plink.anyfeeder.com/thepaper",
    originalCategory: "新闻",
  },
  {
    title: "人民网 / 头条",
    feedUrl: "https://plink.anyfeeder.com/people",
    originalCategory: "新闻",
  },
  {
    title: "人民网 / 国内新闻",
    feedUrl: "https://plink.anyfeeder.com/people/politics",
    originalCategory: "新闻",
  },
  {
    title: "人民网 / 国际新闻",
    feedUrl: "https://plink.anyfeeder.com/people/world",
    originalCategory: "新闻",
  },
  {
    title: "人民网 / 英语新闻",
    feedUrl: "https://plink.anyfeeder.com/people/english",
    originalCategory: "新闻",
  },
  {
    title: "新京报",
    feedUrl: "https://plink.anyfeeder.com/bjnews",
    originalCategory: "新闻",
  },
  {
    title: "人民日报",
    feedUrl: "https://plink.anyfeeder.com/people-daily",
    originalCategory: "新闻",
  },
  {
    title: "光明日报",
    feedUrl: "https://plink.anyfeeder.com/guangmingribao",
    originalCategory: "新闻",
  },
  {
    title: "解放军报",
    feedUrl: "https://plink.anyfeeder.com/jiefangjunbao",
    originalCategory: "新闻",
  },
  {
    title: "中国日报 / 双语新闻",
    feedUrl: "https://plink.anyfeeder.com/chinadaily/dual",
    originalCategory: "新闻",
  },
  {
    title: "中国日报 / 专栏",
    feedUrl: "https://plink.anyfeeder.com/chinadaily/column",
    originalCategory: "新闻",
  },
  {
    title: "中国日报 / 时政",
    feedUrl: "https://plink.anyfeeder.com/chinadaily/china",
    originalCategory: "新闻",
  },
  {
    title: "中国日报 / 资讯",
    feedUrl: "https://plink.anyfeeder.com/chinadaily/world",
    originalCategory: "新闻",
  },
  {
    title: "中国日报 / 财经",
    feedUrl: "https://plink.anyfeeder.com/chinadaily/caijing",
    originalCategory: "新闻",
  },
  {
    title: "喷嚏网 / 铂程斋",
    feedUrl: "https://plink.anyfeeder.com/dapenti/xilei",
    originalCategory: "新闻",
  },
  {
    title: "腾讯新闻 / 国际",
    feedUrl: "https://plink.anyfeeder.com/qq/news/world",
    originalCategory: "新闻",
  },
  {
    title: "腾讯新闻 / 国内",
    feedUrl: "https://plink.anyfeeder.com/qq/news/china",
    originalCategory: "新闻",
  },
  {
    title: "界面新闻: 新闻",
    feedUrl: "https://plink.anyfeeder.com/jiemian/news",
    originalCategory: "新闻",
  },
  {
    title: "Solidot",
    feedUrl: "https://www.solidot.org/index.rss",
    originalCategory: "科技",
  },
  {
    title: "数字尾巴",
    feedUrl: "https://plink.anyfeeder.com/dgtle",
    originalCategory: "科技",
  },
  {
    title: "36氪",
    feedUrl: "https://plink.anyfeeder.com/36kr",
    originalCategory: "科技",
  },
  {
    title: "cnBeta",
    feedUrl: "https://plink.anyfeeder.com/cnbeta",
    originalCategory: "科技",
  },
  {
    title: "IT 之家",
    feedUrl: "https://plink.anyfeeder.com/ithome/it",
    originalCategory: "科技",
  },
  {
    title: "MIT 科技评论 / 本周热榜",
    feedUrl: "https://plink.anyfeeder.com/mittrchina/hot",
    originalCategory: "科技",
  },
  {
    title: "Readhub / 热门话题",
    feedUrl: "https://plink.anyfeeder.com/readhub/topic",
    originalCategory: "科技",
  },
  {
    title: "Readhub / 每日早报",
    feedUrl: "https://plink.anyfeeder.com/readhub/daily",
    originalCategory: "科技",
  },
  {
    title: "Readhub / 区块链快讯",
    feedUrl: "https://plink.anyfeeder.com/readhub/blockchain",
    originalCategory: "科技",
  },
  {
    title: "爱范儿",
    feedUrl: "https://plink.anyfeeder.com/ifanr",
    originalCategory: "科技",
  },
  {
    title: "果壳网 / 科学人",
    feedUrl: "https://plink.anyfeeder.com/guokr/scientific",
    originalCategory: "科技",
  },
  {
    title: "虎嗅",
    feedUrl: "https://plink.anyfeeder.com/huxiu",
    originalCategory: "科技",
  },
  {
    title: "机核",
    feedUrl: "https://plink.anyfeeder.com/gcores",
    originalCategory: "科技",
  },
  {
    title: "快科技",
    feedUrl: "https://plink.anyfeeder.com/mydrivers",
    originalCategory: "科技",
  },
  {
    title: "雷峰网",
    feedUrl: "https://plink.anyfeeder.com/leiphone",
    originalCategory: "科技",
  },
  {
    title: "软餐 - 新鲜软件资讯",
    feedUrl: "https://plink.anyfeeder.com/ruancan",
    originalCategory: "科技",
  },
  {
    title: "少数派",
    feedUrl: "https://plink.anyfeeder.com/sspai",
    originalCategory: "科技",
  },
  {
    title: "少数派 / Matrix",
    feedUrl: "https://plink.anyfeeder.com/ssapi/matrix",
    originalCategory: "科技",
  },
  {
    title: "新浪专栏 / 创事记",
    feedUrl: "https://plink.anyfeeder.com/sina/csj",
    originalCategory: "科技",
  },
  {
    title: "极客公园",
    feedUrl: "https://plink.anyfeeder.com/geekpark",
    originalCategory: "科技",
  },
  {
    title: "小众软件",
    feedUrl: "https://plink.anyfeeder.com/appinn",
    originalCategory: "科技",
  },
  {
    title: "超能网",
    feedUrl: "https://plink.anyfeeder.com/expreview",
    originalCategory: "科技",
  },
  {
    title: "钛媒体",
    feedUrl: "https://plink.anyfeeder.com/tmtpost",
    originalCategory: "科技",
  },
  {
    title: "猎云网",
    feedUrl: "https://plink.anyfeeder.com/lieyunwang",
    originalCategory: "科技",
  },
  {
    title: "品玩",
    feedUrl: "https://plink.anyfeeder.com/pingwest",
    originalCategory: "科技",
  },
  {
    title: "湾区日报",
    feedUrl: "https://wanqu.co/feed/",
    originalCategory: "科技",
  },
  {
    title: "晚晴幽草轩",
    feedUrl: "https://www.jeffjade.com/atom.xml",
    originalCategory: "科技",
  },
  {
    title: "阮一峰的网络日志",
    feedUrl: "https://www.ruanyifeng.com/blog/atom.xml",
    originalCategory: "科技",
  },
  {
    title: "知乎日报",
    feedUrl: "https://plink.anyfeeder.com/zhihu/daily",
    originalCategory: "知识",
  },
  {
    title: "知乎每日精选",
    feedUrl: "http://www.zhihu.com/rss",
    originalCategory: "知识",
  },
  {
    title: "简书 / 首页",
    feedUrl: "https://plink.anyfeeder.com/jianshu/home",
    originalCategory: "知识",
  },
  {
    title: "简书: 热门",
    feedUrl: "https://plink.anyfeeder.com/jianshu/trending/weekly",
    originalCategory: "知识",
  },
  {
    title: "知乎热榜",
    feedUrl: "https://plink.anyfeeder.com/zhihu/hotlist",
    originalCategory: "知识",
  },
  {
    title: "人人都是产品经理",
    feedUrl: "https://plink.anyfeeder.com/woshipm/popular",
    originalCategory: "知识",
  },
  {
    title: "维基百科优良条目",
    feedUrl: "https://zh.wikipedia.org/w/api.php?action=featuredfeed&feed=good&feedformat=atom",
    originalCategory: "知识",
  },
  {
    title: "BBC 英语教学",
    feedUrl: "https://plink.anyfeeder.com/bbc/learningenglish",
    originalCategory: "知识",
  },
  {
    title: "观止·每日一文",
    feedUrl: "https://plink.anyfeeder.com/meiriyiwen",
    originalCategory: "知识",
  },
  {
    title: "豆瓣最受欢迎的影评",
    feedUrl: "https://plink.anyfeeder.com/douban/review/movie",
    originalCategory: "娱乐",
  },
  {
    title: "豆瓣最受欢迎的书评",
    feedUrl: "https://plink.anyfeeder.com/douban/review/book",
    originalCategory: "娱乐",
  },
  {
    title: "雪球 / 今日话题",
    feedUrl: "https://plink.anyfeeder.com/xueqiu/today",
    originalCategory: "财经",
  },
  {
    title: "雪球 / 热帖",
    feedUrl: "https://plink.anyfeeder.com/xueqiu/hot",
    originalCategory: "财经",
  },
  {
    title: "财富中文网",
    feedUrl: "https://plink.anyfeeder.com/fortunechina",
    originalCategory: "财经",
  },
  {
    title: "财富中文网 / 商业",
    feedUrl: "https://plink.anyfeeder.com/fortunechina/shangye",
    originalCategory: "财经",
  },
  {
    title: "财富中文网 / 领导力",
    feedUrl: "https://plink.anyfeeder.com/fortunechina/lindgaoli",
    originalCategory: "财经",
  },
  {
    title: "财富中文网 / 科技",
    feedUrl: "https://plink.anyfeeder.com/fortunechina/keji",
    originalCategory: "财经",
  },
  {
    title: "财富中文网 / 研究",
    feedUrl: "https://plink.anyfeeder.com/fortunechina/report",
    originalCategory: "财经",
  },
  {
    title: "经济日报",
    feedUrl: "https://plink.anyfeeder.com/jingjiribao",
    originalCategory: "财经",
  },
  {
    title: "喷嚏网 / 财经风云",
    feedUrl: "https://plink.anyfeeder.com/dapenti/caijing",
    originalCategory: "财经",
  },
  {
    title: "经济观察网",
    feedUrl: "https://plink.anyfeeder.com/eeo",
    originalCategory: "财经",
  },
  {
    title: "界面新闻: 商业",
    feedUrl: "https://plink.anyfeeder.com/jiemian/business",
    originalCategory: "财经",
  },
  {
    title: "界面新闻: 财经",
    feedUrl: "https://plink.anyfeeder.com/jiemian/finance",
    originalCategory: "财经",
  },
  {
    title: "微博 / 热搜榜",
    feedUrl: "https://plink.anyfeeder.com/weibo/search/hot",
    originalCategory: "生活",
  },
  {
    title: "煎蛋",
    feedUrl: "https://plink.anyfeeder.com/jiandan",
    originalCategory: "生活",
  },
  {
    title: "理想生活实验室",
    feedUrl: "https://plink.anyfeeder.com/toodaylab",
    originalCategory: "生活",
  },
  {
    title: "InfoQ 中文",
    feedUrl: "https://plink.anyfeeder.com/infoq/recommend",
    originalCategory: "编程",
  },
  {
    title: "Readhub / 开发者资讯",
    feedUrl: "https://plink.anyfeeder.com/readhub/technews",
    originalCategory: "编程",
  },
  {
    title: "Linux 中国",
    feedUrl: "https://plink.anyfeeder.com/linux.cn",
    originalCategory: "编程",
  },
  {
    title: "开发者头条",
    feedUrl: "https://plink.anyfeeder.com/toutiao.io",
    originalCategory: "编程",
  },
  {
    title: "FreeBuf 关注黑客",
    feedUrl: "https://plink.anyfeeder.com/freebuf",
    originalCategory: "编程",
  },
  {
    title: "Aljazeera半岛网 / 新闻",
    feedUrl: "https://plink.anyfeeder.com/aljazeera/news",
    originalCategory: "外国媒体",
  },
  {
    title: "SBS 中文",
    feedUrl: "https://plink.anyfeeder.com/sbs/chinese",
    originalCategory: "外国媒体",
  },
  {
    title: "VOA 美国之音",
    feedUrl: "https://plink.anyfeeder.com/voa/chinese",
    originalCategory: "外国媒体",
  },
  {
    title: "端传媒 / 最新",
    feedUrl: "https://plink.anyfeeder.com/initium/latest",
    originalCategory: "外国媒体",
  },
  {
    title: "端传媒 / 深度",
    feedUrl: "https://plink.anyfeeder.com/initium/feature",
    originalCategory: "外国媒体",
  },
  {
    title: "路透中文",
    feedUrl: "https://plink.anyfeeder.com/reuters/cn",
    originalCategory: "外国媒体",
  },
  {
    title: "华尔街日报中文版",
    feedUrl: "https://plink.anyfeeder.com/wsj/cn",
    originalCategory: "外国媒体",
  },
  {
    title: "纽约时报中文网",
    feedUrl: "https://plink.anyfeeder.com/nytimes/cn",
    originalCategory: "外国媒体",
  },
  {
    title: "BBC 中文版",
    feedUrl: "https://plink.anyfeeder.com/bbc/cn",
    originalCategory: "外国媒体",
  },
  {
    title: "RFI 法国国际广播电台",
    feedUrl: "https://plink.anyfeeder.com/rfi/cn",
    originalCategory: "外国媒体",
  },
  {
    title: "ABC 澳大利亚广播公司",
    feedUrl: "https://plink.anyfeeder.com/abc/cn",
    originalCategory: "外国媒体",
  },
  {
    title: "纽约时报双语版",
    feedUrl: "https://plink.anyfeeder.com/nytimes/dual",
    originalCategory: "外国媒体",
  },
  {
    title: "caoz的梦呓",
    feedUrl: "https://plink.anyfeeder.com/weixin/caozsay",
    originalCategory: "公众号",
  },
  {
    title: "keso怎么看",
    feedUrl: "https://plink.anyfeeder.com/weixin/kesoview",
    originalCategory: "公众号",
  },
  {
    title: "读库小报",
    feedUrl: "https://plink.anyfeeder.com/weixin/dukuxiaobao",
    originalCategory: "公众号",
  },
  {
    title: "南方周末",
    feedUrl: "https://plink.anyfeeder.com/weixin/nanfangzhoumo",
    originalCategory: "公众号",
  },
  {
    title: "经济学人",
    feedUrl: "https://plink.anyfeeder.com/weixin/theeconomist",
    originalCategory: "公众号",
  },
  {
    title: "三联生活周刊",
    feedUrl: "https://plink.anyfeeder.com/weixin/lifeweek",
    originalCategory: "公众号",
  },
  {
    title: "单读",
    feedUrl: "https://plink.anyfeeder.com/weixin/dandureading",
    originalCategory: "公众号",
  },
  {
    title: "新世相",
    feedUrl: "https://plink.anyfeeder.com/weixin/thefair2",
    originalCategory: "公众号",
  },
  {
    title: "连岳",
    feedUrl: "https://plink.anyfeeder.com/weixin/ilianyue",
    originalCategory: "公众号",
  },
  {
    title: "南都周刊",
    feedUrl: "https://plink.anyfeeder.com/weixin/nbweekly",
    originalCategory: "公众号",
  },
  {
    title: "人民日报",
    feedUrl: "https://plink.anyfeeder.com/weixin/rmrbwx",
    originalCategory: "公众号",
  },
  {
    title: "十点读书",
    feedUrl: "https://plink.anyfeeder.com/weixin/duhaoshu",
    originalCategory: "公众号",
  },
  {
    title: "洞见",
    feedUrl: "https://plink.anyfeeder.com/weixin/DJ00123987",
    originalCategory: "公众号",
  },
  {
    title: "医学界",
    feedUrl: "https://plink.anyfeeder.com/weixin/yixuejiezazhi",
    originalCategory: "公众号",
  },
  {
    title: "央视财经",
    feedUrl: "https://plink.anyfeeder.com/weixin/cctvyscj",
    originalCategory: "公众号",
  },
  {
    title: "阑夕",
    feedUrl: "https://plink.anyfeeder.com/weixin/techread",
    originalCategory: "公众号",
  },
  {
    title: "半月谈",
    feedUrl: "https://plink.anyfeeder.com/weixin/banyuetan-weixin",
    originalCategory: "公众号",
  },
  {
    title: "理想岛",
    feedUrl: "https://plink.anyfeeder.com/weixin/lixiangdao002",
    originalCategory: "公众号",
  },
  {
    title: "六神磊磊读金庸",
    feedUrl: "https://plink.anyfeeder.com/weixin/dujinyong6",
    originalCategory: "公众号",
  },
  {
    title: "魔宙",
    feedUrl: "https://plink.anyfeeder.com/weixin/mzmojo",
    originalCategory: "公众号",
  },
  {
    title: "东哥解读电商",
    feedUrl: "https://plink.anyfeeder.com/weixin/dgjdds",
    originalCategory: "公众号",
  },
  {
    title: "书单来了",
    feedUrl: "https://plink.anyfeeder.com/weixin/shudanlaile",
    originalCategory: "公众号",
  },
  {
    title: "ImportNew",
    feedUrl: "https://plink.anyfeeder.com/weixin/importnew",
    originalCategory: "公众号",
  },
  {
    title: "界面",
    feedUrl: "https://plink.anyfeeder.com/weixin/wowjiemian",
    originalCategory: "公众号",
  },
  {
    title: "人人都是产品经理",
    feedUrl: "https://plink.anyfeeder.com/weixin/woshipm",
    originalCategory: "公众号",
  },
  {
    title: "架构师之路",
    feedUrl: "https://plink.anyfeeder.com/weixin/gh_10a6b96351a9",
    originalCategory: "公众号",
  },
  {
    title: "青年文摘",
    feedUrl: "https://plink.anyfeeder.com/weixin/qnwzwx",
    originalCategory: "公众号",
  },
  {
    title: "历史研习社",
    feedUrl: "https://plink.anyfeeder.com/weixin/mingqinghistory",
    originalCategory: "公众号",
  },
  {
    title: "译言",
    feedUrl: "https://plink.anyfeeder.com/weixin/yeeyancom",
    originalCategory: "公众号",
  },
  {
    title: "真实故事计划",
    feedUrl: "https://plink.anyfeeder.com/weixin/zhenshigushi1",
    originalCategory: "公众号",
  },
  {
    title: "知识分子",
    feedUrl: "https://plink.anyfeeder.com/weixin/The-Intellectual",
    originalCategory: "公众号",
  },
  {
    title: "财新网",
    feedUrl: "https://plink.anyfeeder.com/weixin/caixinwang",
    originalCategory: "公众号",
  },
  {
    title: "侠客岛",
    feedUrl: "https://plink.anyfeeder.com/weixin/xiake_island",
    originalCategory: "公众号",
  },
  {
    title: "棱镜",
    feedUrl: "https://plink.anyfeeder.com/weixin/lengjing_qqfinance",
    originalCategory: "公众号",
  },
  {
    title: "香港凤凰周刊",
    feedUrl: "https://plink.anyfeeder.com/weixin/phoenixweekly",
    originalCategory: "公众号",
  },
  {
    title: "国家人文历史",
    feedUrl: "https://plink.anyfeeder.com/weixin/gjrwls",
    originalCategory: "公众号",
  },
  {
    title: "机器之心",
    feedUrl: "https://plink.anyfeeder.com/weixin/almosthuman2014",
    originalCategory: "公众号",
  },
  {
    title: "果壳网",
    feedUrl: "https://plink.anyfeeder.com/weixin/Guokr42",
    originalCategory: "公众号",
  },
  {
    title: "虹膜",
    feedUrl: "https://plink.anyfeeder.com/weixin/IrisMagazine",
    originalCategory: "公众号",
  },
  {
    title: "新京报书评周刊",
    feedUrl: "https://plink.anyfeeder.com/weixin/ibookreview",
    originalCategory: "公众号",
  },
  {
    title: "环球时报",
    feedUrl: "https://plink.anyfeeder.com/weixin/hqsbwx",
    originalCategory: "公众号",
  },
  {
    title: "铁血军事",
    feedUrl: "https://plink.anyfeeder.com/weixin/tiexuejunshi",
    originalCategory: "公众号",
  },
  {
    title: "人民网",
    feedUrl: "https://plink.anyfeeder.com/weixin/people_rmw",
    originalCategory: "公众号",
  },
  {
    title: "丁香医生",
    feedUrl: "https://plink.anyfeeder.com/weixin/DingXiangYiSheng",
    originalCategory: "公众号",
  },
  {
    title: "澎湃新闻",
    feedUrl: "https://plink.anyfeeder.com/weixin/thepapernews",
    originalCategory: "公众号",
  },
  {
    title: "新华网",
    feedUrl: "https://plink.anyfeeder.com/weixin/newsxinhua",
    originalCategory: "公众号",
  },
  {
    title: "糗事百科",
    feedUrl: "https://plink.anyfeeder.com/weixin/qiubai2005",
    originalCategory: "公众号",
  },
  {
    title: "虎嗅网",
    feedUrl: "https://plink.anyfeeder.com/weixin/huxiu_com",
    originalCategory: "公众号",
  },
  {
    title: "参考消息",
    feedUrl: "https://plink.anyfeeder.com/weixin/ckxxwx",
    originalCategory: "公众号",
  },
  {
    title: "Vista看天下",
    feedUrl: "https://plink.anyfeeder.com/weixin/vistaweek",
    originalCategory: "公众号",
  },
  {
    title: "小道消息",
    feedUrl: "https://plink.anyfeeder.com/weixin/WebNotes",
    originalCategory: "公众号",
  },
  {
    title: "有书",
    feedUrl: "https://plink.anyfeeder.com/weixin/youshucc",
    originalCategory: "公众号",
  },
  {
    title: "简书",
    feedUrl: "https://plink.anyfeeder.com/weixin/jianshuio",
    originalCategory: "公众号",
  },
  {
    title: "经济观察报",
    feedUrl: "https://plink.anyfeeder.com/weixin/eeo-com-cn",
    originalCategory: "公众号",
  },
  {
    title: "第一财经周刊",
    feedUrl: "https://plink.anyfeeder.com/weixin/CBNweekly2008",
    originalCategory: "公众号",
  },
  {
    title: "MacTalk",
    feedUrl: "https://plink.anyfeeder.com/weixin/sagacity-mac",
    originalCategory: "公众号",
  },
  {
    title: "新浪体育",
    feedUrl: "https://plink.anyfeeder.com/weixin/sports_sina",
    originalCategory: "公众号",
  },
  {
    title: "华尔街见闻",
    feedUrl: "https://plink.anyfeeder.com/weixin/wallstreetcn",
    originalCategory: "公众号",
  },
  {
    title: "吴晓波频道",
    feedUrl: "https://plink.anyfeeder.com/weixin/wuxiaobopd",
    originalCategory: "公众号",
  },
  {
    title: "21世纪经济报道",
    feedUrl: "https://plink.anyfeeder.com/weixin/jjbd21",
    originalCategory: "公众号",
  },
  {
    title: "前端之巅",
    feedUrl: "https://plink.anyfeeder.com/weixin/frontshow",
    originalCategory: "公众号",
  },
  {
    title: "丁香妈妈",
    feedUrl: "https://plink.anyfeeder.com/weixin/DingXiangMaMi",
    originalCategory: "公众号",
  },
  {
    title: "人物",
    feedUrl: "https://plink.anyfeeder.com/weixin/renwumag1980",
    originalCategory: "公众号",
  },
  {
    title: "看理想",
    feedUrl: "https://plink.anyfeeder.com/weixin/ikanlixiang",
    originalCategory: "公众号",
  },
  {
    title: "罗辑思维",
    feedUrl: "https://plink.anyfeeder.com/weixin/luojisw",
    originalCategory: "公众号",
  },
  {
    title: "Knowyourself",
    feedUrl: "https://plink.anyfeeder.com/weixin/knowyourself2015",
    originalCategory: "公众号",
  },
  {
    title: "读小库",
    feedUrl: "https://plink.anyfeeder.com/weixin/duxiaoku666",
    originalCategory: "公众号",
  },
  {
    title: "槽边往事",
    feedUrl: "https://plink.anyfeeder.com/weixin/bitsea",
    originalCategory: "公众号",
  },
  {
    title: "脑洞故事板",
    feedUrl: "https://plink.anyfeeder.com/weixin/ndgs233",
    originalCategory: "公众号",
  },
  {
    title: "环球科学",
    feedUrl: "https://plink.anyfeeder.com/weixin/ScientificAmerican",
    originalCategory: "公众号",
  },
  {
    title: "地球知识局",
    feedUrl: "https://plink.anyfeeder.com/weixin/diqiuzhishiju",
    originalCategory: "公众号",
  },
  {
    title: "中国国家地理",
    feedUrl: "https://plink.anyfeeder.com/weixin/dili360",
    originalCategory: "公众号",
  },
  {
    title: "雪球",
    feedUrl: "https://plink.anyfeeder.com/weixin/xueqiujinghua",
    originalCategory: "公众号",
  },
  {
    title: "微软研究院AI头条",
    feedUrl: "https://plink.anyfeeder.com/weixin/MSRAsia",
    originalCategory: "公众号",
  },
  {
    title: "新智元",
    feedUrl: "https://plink.anyfeeder.com/weixin/AI_era",
    originalCategory: "公众号",
  },
  {
    title: "长安街知事",
    feedUrl: "https://plink.anyfeeder.com/weixin/capitalnews",
    originalCategory: "公众号",
  },
  {
    title: "腾讯科技",
    feedUrl: "https://plink.anyfeeder.com/weixin/qqtech",
    originalCategory: "公众号",
  },
  {
    title: "科技美学",
    feedUrl: "https://plink.anyfeeder.com/weixin/kejimx",
    originalCategory: "公众号",
  },
  {
    title: "CSDN",
    feedUrl: "https://plink.anyfeeder.com/weixin/CSDNnews",
    originalCategory: "公众号",
  },
  {
    title: "唐书房",
    feedUrl: "https://plink.anyfeeder.com/weixin/clouds70",
    originalCategory: "公众号",
  },
  {
    title: "毛有话说",
    feedUrl: "https://plink.anyfeeder.com/weixin/mao-talk",
    originalCategory: "公众号",
  },
  {
    title: "搬砖小组",
    feedUrl: "https://plink.anyfeeder.com/weixin/banzhuanxiaozu",
    originalCategory: "公众号",
  },
  {
    title: "一天一篇经济学人(双语)",
    feedUrl: "https://plink.anyfeeder.com/weixin/Economist_fans",
    originalCategory: "公众号",
  },
  {
    title: "央视新闻",
    feedUrl: "https://plink.anyfeeder.com/weixin/cctvnewscenter",
    originalCategory: "公众号",
  },
  {
    title: "MOOC",
    feedUrl: "https://plink.anyfeeder.com/weixin/mooc",
    originalCategory: "公众号",
  },
  {
    title: "三节课",
    feedUrl: "https://plink.anyfeeder.com/weixin/sanjieke01",
    originalCategory: "公众号",
  },
  {
    title: "利维坦",
    feedUrl: "https://plink.anyfeeder.com/weixin/liweitan2014",
    originalCategory: "公众号",
  },
  {
    title: "饭统戴老板",
    feedUrl: "https://plink.anyfeeder.com/weixin/worldofboss",
    originalCategory: "公众号",
  },
  {
    title: "刘润",
    feedUrl: "https://plink.anyfeeder.com/weixin/runliu-pub",
    originalCategory: "公众号",
  },
  {
    title: "笔记侠",
    feedUrl: "https://plink.anyfeeder.com/weixin/Notesman",
    originalCategory: "公众号",
  },
  {
    title: "张佳玮写字的地方",
    feedUrl: "https://plink.anyfeeder.com/weixin/zhangjiawei_1983",
    originalCategory: "公众号",
  },
  {
    title: "德林社",
    feedUrl: "https://plink.anyfeeder.com/weixin/delinshe",
    originalCategory: "公众号",
  },
  {
    title: "中国企业家杂志",
    feedUrl: "https://plink.anyfeeder.com/weixin/iceo-com-cn",
    originalCategory: "公众号",
  },
  {
    title: "新经济100人",
    feedUrl: "https://plink.anyfeeder.com/weixin/qiyejiagc",
    originalCategory: "公众号",
  },
  {
    title: "新财富",
    feedUrl: "https://plink.anyfeeder.com/weixin/newfortune",
    originalCategory: "公众号",
  },
  {
    title: "福布斯",
    feedUrl: "https://plink.anyfeeder.com/weixin/forbes_china",
    originalCategory: "公众号",
  },
  {
    title: "美股研究社",
    feedUrl: "https://plink.anyfeeder.com/weixin/meigushe",
    originalCategory: "公众号",
  },
  {
    title: "X博士",
    feedUrl: "https://plink.anyfeeder.com/weixin/doctorx666",
    originalCategory: "公众号",
  },
  {
    title: "科学松鼠会",
    feedUrl: "https://plink.anyfeeder.com/weixin/SquirrelClub",
    originalCategory: "公众号",
  },
  {
    title: "物种日历",
    feedUrl: "https://plink.anyfeeder.com/weixin/guokrpac",
    originalCategory: "公众号",
  },
  {
    title: "叶檀财经",
    feedUrl: "https://plink.anyfeeder.com/weixin/tancaijing",
    originalCategory: "公众号",
  },
  {
    title: "LinkedIn 领英",
    feedUrl: "https://plink.anyfeeder.com/weixin/LinkedIn-China",
    originalCategory: "公众号",
  },
  {
    title: "哈佛商业评论",
    feedUrl: "https://plink.anyfeeder.com/weixin/hbrchinese",
    originalCategory: "公众号",
  },
  {
    title: "猫笔刀",
    feedUrl: "https://plink.anyfeeder.com/weixin/maobidao",
    originalCategory: "公众号",
  },
  {
    title: "经济学原理",
    feedUrl: "https://plink.anyfeeder.com/weixin/jingjixue_yuanli",
    originalCategory: "公众号",
  },
] as const satisfies readonly CuratedSourceSeed[];
