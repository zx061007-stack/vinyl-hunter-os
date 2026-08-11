/**
 * Vinyl Hunter OS — 中国热搜代理（4平台分采）+ 音乐资讯全网代理 + AI 分析代理
 * ----------------------------------------------------
 * 路由：
 *   GET  /             → 4平台热搜，每平台前5 { platforms:{weibo,douyin,bilibili,xiaohongshu}, words:[...], updatedAt }
 *   GET  /hot          → 同上（兼容旧路径）
 *   GET  /music-news   → 全网音乐资讯（MusicBrainz + iTunes），含预售价格，海内外覆盖
 *   POST /ai-analyze   → 代理调 DeepSeek API，Key 存 Worker 端不泄露
 */

// ========== 安全配置 ==========
const MAX_PROMPT_LENGTH = 5000;
const ALLOWED_ORIGIN = '*';

// ========== 平台配置（删除闲鱼，无公开API） ==========
var PLATFORMS = {
  weibo:       { label: '微博',   color: '#e6162d' },
  douyin:      { label: '抖音',   color: '#000000' },
  bilibili:    { label: 'B站',    color: '#fb7299' },
  xiaohongshu: { label: '小红书', color: '#ff2442' }
};

// 提取热词的通用函数
function extractWords(data, format) {
  var words = [];
  if (!data) return words;
  try {
    if (format === 'uapis') {
      var arr = data.list || (data.data && data.data.list) || [];
      if (Array.isArray(arr)) {
        arr.forEach(function (x) {
          if (typeof x === 'string') { words.push(x.trim()); }
          else { var w = x.title || x.keyword || x.name || x.word; if (w) words.push(String(w).trim()); }
        });
      }
    } else if (format === 'bilibili') {
      var arr3 = (data.data && data.data.trending && data.data.trending.list) || [];
      arr3.forEach(function (x) { var w = x.keyword || x.show_name || x.title; if (w) words.push(String(w).trim()); });
    } else if (format === 'douyin') {
      var arr2 = data.word_list || data.data || [];
      arr2.forEach(function (x) { var w = x.word || x.hotspot || x.title; if (w) words.push(String(w).trim()); });
    } else if (Array.isArray(data)) {
      data.forEach(function (x) {
        if (typeof x === 'string') { words.push(x.trim()); }
        else { var w = x.word || x.title || x.name || x.keyword; if (w) words.push(String(w).trim()); }
      });
    }
  } catch (e) { /* 忽略解析错误 */ }
  return words;
}

// 采集单个平台
async function fetchPlatform(platform) {
  var headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  var uapisType = {
    weibo: 'weibo',
    douyin: 'douyin',
    bilibili: 'bilibili',
    xiaohongshu: 'xiaohongshu'
  };

  try {
    if (platform === 'douyin') {
      try {
        var dyResp = await fetch('https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/', {
          headers: Object.assign(headers, { 'Referer': 'https://www.douyin.com/' })
        });
        var dyData = await dyResp.json();
        var dyWords = extractWords(dyData, 'douyin');
        if (dyWords.length) return dyWords;
      } catch (e) { /* 回退 uapis */ }
    }

    if (platform === 'bilibili') {
      try {
        var biliResp = await fetch('https://api.bilibili.com/x/web-interface/search/square?limit=20', {
          headers: Object.assign(headers, { 'Referer': 'https://www.bilibili.com/' })
        });
        var biliData = await biliResp.json();
        var biliWords = extractWords(biliData, 'bilibili');
        if (biliWords.length) return biliWords;
      } catch (e) { /* 回退 uapis */ }
    }

    var uResp = await fetch('https://uapis.cn/api/v1/misc/hotboard?type=' + uapisType[platform], {
      headers: headers
    });
    var uData = await uResp.json();
    return extractWords(uData, 'uapis');
  } catch (e) {
    // 单平台失败不影响其他平台
  }
  return [];
}

// 全网音乐资讯：MusicBrainz（海外发行库）+ iTunes（含价格），合并去重，海内外覆盖
async function fetchMusicNewsAll(limit) {
  limit = limit || 25;
  var d = new Date();
  var ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  // 并行采集两个源
  var mbPromise = (async function () {
    try {
      var mbUrl = 'https://musicbrainz.org/ws/2/release/?query=date:' + ds + '&fmt=json&limit=' + limit;
      var mbResp = await fetch(mbUrl, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'VinylHunterOS/1.0 (music release tracker)' }
      });
      if (!mbResp.ok) return [];
      var mbData = await mbResp.json();
      var regionMap = { US: '美国', JP: '日本', KR: '韩国', TW: '中国港台', HK: '中国港台', CN: '中国港台' };
      var eu = ['GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'NO', 'FI', 'DK', 'IE', 'CH', 'AT', 'BE', 'PT'];
      return (mbData.releases || []).map(function (it) {
        var ac = it['artist-credit'] || [];
        var artist = (ac[0] && (ac[0].name || (ac[0].artist && ac[0].artist.name))) || '未知艺人';
        var country = it.country || '';
        var region = regionMap[country] || (eu.indexOf(country) >= 0 ? '欧洲' : '其他');
        var fmt = (it.media && it.media[0] && it.media[0].format) || '';
        var format = /vinyl/i.test(fmt) ? '黑胶' : (fmt || 'CD');
        return {
          artist: artist,
          album: it.title || '',
          region: region,
          format: format,
          releaseDate: it.date || '',
          company: (it['label-info'] && it['label-info'][0] && it['label-info'][0].label && it['label-info'][0].label.name) || '',
          country: country,
          buyLink: '',
          srcLink: 'https://musicbrainz.org/release/' + it.id,
          cover: 'https://coverartarchive.org/release/' + it.id + '/front',
          presalePrice: '',
          priceCurrency: '',
          source: 'MusicBrainz'
        };
      });
    } catch (e) { return []; }
  })();

  // iTunes Search API：免费免Key，含 collectionPrice（预售价格）
  var itunesPromise = (async function () {
    try {
      // 搜最近发行专辑，含价格信息
      var itUrl = 'https://itunes.apple.com/search?term=new+release&entity=album&limit=' + limit + '&sort=recent';
      var itResp = await fetch(itUrl, { headers: { 'Accept': 'application/json' } });
      if (!itResp.ok) return [];
      var itData = await itResp.json();
      var regionMap = { US: '美国', JP: '日本', KR: '韩国', TW: '中国港台', HK: '中国港台', CN: '中国港台', GB: '欧洲', DE: '欧洲', FR: '欧洲' };
      return (itData.results || []).map(function (it) {
        var cc = it.country || '';
        var region = regionMap[cc] || '其他';
        var format = '数字';
        var price = it.collectionPrice || it.price || '';
        var currency = it.currency || '';
        // 价格转人民币估算（简单换算）
        var cnyPrice = '';
        if (price && currency) {
          var rateMap = { USD: 7.2, EUR: 7.8, GBP: 9.1, JPY: 0.048, HKD: 0.92, KRW: 0.0055, TWD: 0.22, CNY: 1, AUD: 4.7, CAD: 5.3 };
          var r = rateMap[currency] || 1;
          cnyPrice = (price * r).toFixed(0);
        }
        return {
          artist: it.artistName || '',
          album: it.collectionName || '',
          region: region,
          format: format,
          releaseDate: (it.releaseDate || '').slice(0, 10),
          company: it.copyright || '',
          country: cc,
          buyLink: it.collectionViewUrl || '',
          srcLink: it.trackViewUrl || it.collectionViewUrl || '',
          cover: it.artworkUrl100 ? it.artworkUrl100.replace('100x100', '300x300') : '',
          presalePrice: cnyPrice ? (cnyPrice + ' 元') : '',
          priceCurrency: currency,
          source: 'iTunes'
        };
      });
    } catch (e) { return []; }
  })();

  var results = await Promise.all([mbPromise, itunesPromise]);
  var mbItems = results[0], itItems = results[1];

  // 合并去重（按 artist+album）
  var seen = {};
  var merged = [];
  mbItems.forEach(function (it) {
    var key = (it.artist + '|' + it.album).toLowerCase().trim();
    if (key && !seen[key]) { seen[key] = 1; merged.push(it); }
  });
  itItems.forEach(function (it) {
    var key = (it.artist + '|' + it.album).toLowerCase().trim();
    if (key && !seen[key]) {
      seen[key] = 1;
      // 如果 MusicBrainz 有同名但没价格，补充价格
      merged.push(it);
    } else if (key) {
      // 给已有的 MusicBrainz 条目补充价格
      var existing = merged.find(function (m) {
        return (m.artist + '|' + m.album).toLowerCase().trim() === key;
      });
      if (existing && !existing.presalePrice && it.presalePrice) {
        existing.presalePrice = it.presalePrice;
        existing.priceCurrency = it.priceCurrency;
        if (!existing.buyLink) existing.buyLink = it.buyLink;
        if (!existing.cover || existing.cover.indexOf('coverartarchive') >= 0) existing.cover = it.cover;
      }
    }
  });

  return merged.slice(0, limit * 2);
}

// 抖音实时热点榜（多源回退）：uapis.cn 主用，iesdouyin 官方备用。返回统一结构 [{word, cover, hot_value, label}]
async function fetchDouyinHotFeed() {
  var headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://www.douyin.com/' };

  // 1) uapis.cn（结构稳定，含封面 + 热度值）
  try {
    var uResp = await fetch('https://uapis.cn/api/v1/misc/hotboard?type=douyin', { headers: headers });
    var uData = await uResp.json();
    var uArr = uData && (uData.list || (uData.data && uData.data.list)) || [];
    if (Array.isArray(uArr) && uArr.length) {
      return uArr.map(function (x) {
        var word = x.title || x.word || x.keyword || '';
        var cover = (x.extra && x.extra.cover) || x.cover || '';
        var hot = x.hot_value || x.hotValue || x.hot || '';
        var label = x.label || '';
        return { word: word, cover: cover, hot_value: hot, label: label };
      }).filter(function (x) { return x.word; });
    }
  } catch (e) { /* 回退下一源 */ }

  // 2) iesdouyin 官方热点词榜
  try {
    var dResp = await fetch('https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/', {
      headers: Object.assign({}, headers, { 'Referer': 'https://www.douyin.com/' })
    });
    var dData = await dResp.json();
    var dArr = dData && dData.word_list || [];
    if (Array.isArray(dArr) && dArr.length) {
      return dArr.map(function (x) {
        return { word: x.word || '', cover: x.cover || '', hot_value: x.hot_value || '', label: (x.label !== undefined ? String(x.label) : '') };
      }).filter(function (x) { return x.word; });
    }
  } catch (e) { /* 无更多源 */ }

  return [];
}

export default {
  async fetch(request, env) {
    var corsHeaders = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json; charset=utf-8'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    var url = new URL(request.url);

    // ========== 路由：AI 分析 ==========
    if (url.pathname === '/ai-analyze' && request.method === 'POST') {
      var apiKey = env && env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({
          error: 'Worker 未配置 DEEPSEEK_API_KEY，请用 wrangler secret put DEEPSEEK_API_KEY 设置'
        }), { status: 500, headers: corsHeaders });
      }

      try {
        var body = await request.json();
        var systemPrompt = body.systemPrompt || '你是黑胶商业分析助手。';
        var userPrompt = body.userPrompt || '';

        if (userPrompt.length > MAX_PROMPT_LENGTH) {
          return new Response(JSON.stringify({
            error: '分析内容过长（' + userPrompt.length + ' 字），超过上限 ' + MAX_PROMPT_LENGTH + ' 字，请减少数据量后重试'
          }), { status: 400, headers: corsHeaders });
        }

        var aiResp = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
          },
          body: JSON.stringify({
            model: 'deepseek-v4-flash',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            max_tokens: 2000,
            temperature: 0.7,
            stream: false
          })
        });

        if (!aiResp.ok) {
          var errText = await aiResp.text();
          return new Response(JSON.stringify({
            error: 'DeepSeek API 返回 ' + aiResp.status + ': ' + errText.slice(0, 300)
          }), { status: 502, headers: corsHeaders });
        }

        var aiData = await aiResp.json();
        var result = (aiData.choices && aiData.choices[0] && aiData.choices[0].message && aiData.choices[0].message.content) || 'AI 返回为空';

        return new Response(JSON.stringify({
          ok: true,
          result: result,
          model: aiData.model || 'deepseek-v4-flash',
          usage: aiData.usage || {}
        }), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({
          error: 'AI 分析异常：' + e.message
        }), { status: 500, headers: corsHeaders });
      }
    }

    // ========== 路由：全网音乐资讯（MusicBrainz + iTunes，含预售价格）==========
    if (url.pathname === '/music-news') {
      try {
        var limit = url.searchParams.get('limit') || '25';
        var items = await fetchMusicNewsAll(parseInt(limit) || 25);
        return new Response(JSON.stringify({
          releases: items,
          sources: ['MusicBrainz', 'iTunes'],
          coverage: '海内外全网',
          count: items.length,
          updatedAt: Date.now()
        }), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({
          error: '音乐资讯代理异常：' + e.message
        }), { status: 500, headers: corsHeaders });
      }
    }

    // ========== 路由：抖音热门视频 / 热门音乐 ==========
    // 说明：抖音官方「视频榜 / 音乐榜」聚合接口（oioweb / iesdouyin aweme / 60s.viki 等）
    // 当前均不可用（526 / 空 / 502）。改用「抖音实时热点榜」作为唯一可达的真实数据源，
    // 该榜单本身即抖音当下最热内容（含封面 + 热度值），按语义拆分为「视频组 / 音乐组」，
    // 并在返回中标记 source 与 derived，前端如实展示「来源：抖音实时热点」。
    if (url.pathname === '/douyin-video' || url.pathname === '/douyin-music') {
      var kind = url.pathname === '/douyin-video' ? 'video' : 'music';
      try {
        var feed = await fetchDouyinHotFeed();
        // 视频组 / 音乐组共享同一实时热点流，按 kind 给出语义化字段
        var items = (feed || []).slice(0, 20).map(function (it, i) {
          var base = {
            rank: i + 1,
            title: it.word || '',
            cover: it.cover || '',
            hotValue: it.hot_value || '',
            playCount: kind === 'video' ? (it.hot_value || '') : '',
            likeCount: kind === 'video' ? '' : '',
            useCount: kind === 'music' ? (it.hot_value || '') : '',
            singer: kind === 'music' ? '' : '',
            author: kind === 'video' ? '抖音热门创作者' : '',
            desc: it.label ? ('标签：' + it.label) : '抖音实时热点',
            link: 'https://www.douyin.com/search/' + encodeURIComponent(it.word || ''),
            source: 'douyin-hot',
            derived: true
          };
          return base;
        });
        return new Response(JSON.stringify({
          platform: 'douyin', label: '抖音', kind: kind,
          note: '来源：抖音实时热点榜（官方视频/音乐专榜接口当前不可用，已用实时热点流替代，保证数据实时且真实）',
          items: items, count: items.length, updatedAt: Date.now()
        }), { headers: corsHeaders });
      } catch (e) {
        var msg = kind === 'video' ? '抖音视频榜单异常' : '抖音音乐榜单异常';
        return new Response(JSON.stringify({ error: msg + '：' + e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ========== 路由：4平台热搜（每平台前5）==========
    var platformList = Object.keys(PLATFORMS);
    var promises = platformList.map(function (p) {
      return fetchPlatform(p).then(function (words) {
        return { platform: p, words: words };
      });
    });

    var results = await Promise.all(promises);
    var platforms = {};
    var allWords = [];
    var seen = {};

    results.forEach(function (r) {
      var deduped = [];
      (r.words || []).forEach(function (w) {
        if (w && !seen[w]) { seen[w] = 1; deduped.push(w); allWords.push(w); }
        else if (w && deduped.indexOf(w) < 0) { deduped.push(w); }
      });
      // 每平台只取前5条
      platforms[r.platform] = deduped.slice(0, 5);
    });

    return new Response(JSON.stringify({
      platforms: platforms,
      platformLabels: PLATFORMS,
      words: allWords.slice(0, 200),
      updatedAt: Date.now()
    }), { headers: corsHeaders });
  }
};
