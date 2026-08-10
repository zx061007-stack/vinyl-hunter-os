/* ============================================================
 * Vinyl Hunter OS — 数据采集接口 (api.js)
 * 重要：本文件中的所有函数都不会被自动调用。
 * 仅当用户在界面点击「采集 / 更新 / 刷新」按钮时，
 * 由 app.js 的采集封装函数显式调用，避免消耗 Token / API 额度。
 * ============================================================ */
(function (global) {
  'use strict';

  // 实时汇率：免费、无需 Key、支持 CORS。
  // 返回 { date, rates:{ USD,HKD,TWD,JPY,KRW,GBP,EUR } }，值为「1 单位外币 = 多少人民币」
  function fetchExchangeRates() {
    return fetch('https://open.er-api.com/v6/latest/USD')
      .then(function (r) {
        if (!r.ok) throw new Error('汇率接口返回 ' + r.status);
        return r.json();
      })
      .then(function (d) {
        var rates = d.rates;
        if (!rates || !rates.CNY) throw new Error('汇率数据缺失');
        var cny = rates.CNY;
        var cur = ['USD', 'HKD', 'TWD', 'JPY', 'KRW', 'GBP', 'EUR'];
        var out = {};
        cur.forEach(function (c) { out[c] = cny / rates[c]; });
        return { date: new Date().toISOString().slice(0, 10), rates: out };
      });
  }

  // Discogs 地址拼接：若配置了代理（Cloudflare Worker 等），把整条 path+query 转发到代理，
  // 由代理加 CORS 头并回源 api.discogs.com（Token 仍在 query 中，由代理透传）。
  function discogsUrl(path, token, proxy) {
    var target = 'https://api.discogs.com' + path +
      (path.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(token);
    if (proxy) return proxy.replace(/\/$/, '') + target.slice('https://api.discogs.com'.length);
    return target;
  }

  // Discogs 搜索（按专辑/歌手/Catalog）。需要用户在系统设置填写 Discogs Token。
  function fetchDiscogs(query, token, proxy) {
    if (!token) throw new Error('缺少 Discogs Token');
    var path = '/database/search?q=' + encodeURIComponent(query) + '&type=release&per_page=15';
    var url = discogsUrl(path, token, proxy);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('Discogs API ' + r.status);
      return r.json();
    }).then(function (d) {
      return (d.results || []).map(function (it) {
        var title = (it.title || '').split(' - ');
        var labels = it.labels || [];
        return {
          id: it.id,
          artist: (title[0] || '').trim(),
          album: (title.slice(1).join(' - ') || '').trim(),
          catalog: (labels[0] && labels[0].catno) || '',
          label: (labels[0] && labels[0].name) || '',
          year: it.year || '',
          country: it.country || '',
          version: (it.format || []).join(', '),
          marketPrice: (it.community && it.community.price && it.community.price.suggested) || '',
          link: it.uri || '',
          cover: it.cover_image || ''
        };
      });
    });
  }

  // Discogs 单曲详情（版本/收藏/图片/市场参考价）。需要 release id。
  function fetchDiscogsRelease(id, token, proxy) {
    if (!token) throw new Error('缺少 Discogs Token');
    var relUrl = discogsUrl('/releases/' + id, token, proxy);
    var statsUrl = discogsUrl('/marketplace/stats/' + id, token, proxy);
    return fetch(relUrl).then(function (r) {
      if (!r.ok) throw new Error('Discogs API ' + r.status);
      return r.json();
    }).then(function (rel) {
      return fetch(statsUrl).then(function (s) { return s.ok ? s.json() : { lowest_price: null }; })
        .catch(function () { return { lowest_price: null }; })
        .then(function (stats) {
          var title = (rel.title || '').split(' - ');
          var labels = rel.labels || [];
          var catno = (labels[0] && labels[0].catno) || '';
          var fmts = rel.formats || [];
          var versionParts = [];
          fmts.forEach(function (f) {
            if (f.name) versionParts.push(f.name);
            if (f.descriptions) versionParts = versionParts.concat(f.descriptions);
          });
          var images = (rel.images || []).map(function (i) { return i.uri; }).filter(Boolean);
          var cover = (images[0]) || rel.cover_image || '';
          // 限量 / 重量 / 彩胶 关键词识别（来自版本描述）
          var vp = versionParts.join(' ').toLowerCase();
          var limited = /limited|limited edition|numbered/.test(vp) ? '限量版' : '';
          var weight = (vp.match(/(\d{3})\s?g/) || [])[0] || '';
          var colored = /colou?r|picture disc/.test(vp) ? '彩胶/Picture' : '';
          var special = [limited, weight, colored].filter(Boolean).join(' · ');
          return {
            id: id,
            artist: (title[0] || '').trim(),
            album: (title.slice(1).join(' - ') || '').trim(),
            catalog: catno,
            label: (labels[0] && labels[0].name) || '',
            year: rel.year || '',
            country: rel.country || '',
            genre: (rel.genres || []).join(', '),
            style: (rel.styles || []).join(', '),
            version: versionParts.join(', '),
            cover: cover,
            images: images,
            marketPrice: stats.lowest_price ? stats.lowest_price.value : '',
            priceCurrency: stats.lowest_price ? stats.lowest_price.currency : '',
            limited: special,
            // 社区数据：支撑「黑胶全分析」的海外热度计算
            want: (rel.community && rel.community.want) || 0,
            have: (rel.community && rel.community.have) || 0,
            numForSale: rel.num_for_sale || 0
          };
        });
    });
  }

  // 通用 JSON 获取（用户自行配置的资讯源 / 热点源）
  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('接口返回 ' + r.status);
      return r.json();
    });
  }

  // 全球音乐资讯默认源：MusicBrainz 发行数据库。
  // 免费、免 Key、支持 CORS（Access-Control-Allow-Origin: *），浏览器可直接请求。
  // 返回与音乐资讯模块兼容的 items 数组：artist/album/region/format/releaseDate/
  // company/country/buyLink/srcLink/cover。
  function fetchMusicBrainzNews(limit) {
    limit = limit || 25;
    var d = new Date();
    var ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var url = 'https://musicbrainz.org/ws/2/release/?query=date:' + ds + '&fmt=json&limit=' + limit;
    return fetch(url, { headers: { 'Accept': 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('MusicBrainz ' + r.status);
      return r.json();
    }).then(function (data) {
      var regionMap = { US: '美国', JP: '日本', KR: '韩国', TW: '中国港台', HK: '中国港台', CN: '中国港台' };
      var eu = ['GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'NO', 'FI', 'DK', 'IE', 'CH', 'AT', 'BE', 'PT'];
      return (data.releases || []).map(function (it) {
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
          company: '',
          country: country,
          buyLink: '',
          srcLink: 'https://musicbrainz.org/release/' + it.id,
          cover: 'https://coverartarchive.org/release/' + it.id + '/front',
          source: 'MusicBrainz'
        };
      });
    });
  }

  // 中国热度信号：经用户自部署的代理（Cloudflare Worker 等）拉取微博/抖音热搜词。
  // 代理需返回标准化 { words: ["词1","词2",...] }（也兼容微博 {data:{realtime:[{word}]}}、
  // 抖音 {word_list:[{word}]} 等格式）。代理负责解决浏览器跨域(CORS)。
  // 仅在用户点击【开始分析】且配置了代理地址时才调用——按钮触发，不自动联网。
  function fetchChinaHotWords(proxyUrl) {
    return fetchJson(proxyUrl).then(function (data) {
      var words = [];
      function push(x) { var s = x && (x.word || x.title || x.name || x); if (s && String(s).trim()) words.push(String(s).trim()); }
      if (data && Array.isArray(data.words)) data.words.forEach(push);
      else if (data && data.data && Array.isArray(data.data.realtime)) data.data.realtime.forEach(push);
      else if (data && Array.isArray(data.word_list)) data.word_list.forEach(push);
      else if (data && Array.isArray(data.trending)) data.trending.forEach(push);
      else if (Array.isArray(data)) data.forEach(push);
      var seen = {}, uniq = [];
      words.forEach(function (w) { if (!seen[w]) { seen[w] = 1; uniq.push(w); } });
      return uniq.slice(0, 200);
    });
  }

  // AI 分析：通过用户自部署的 Worker 代理调用 AI（DeepSeek 等）。
  // Worker 持有 API Key（服务端密钥），前端只传 module / systemPrompt / userPrompt / data。
  // 仅在用户点击【AI分析】按钮时调用——按钮触发，不自动联网，不后台运行。
  // proxyUrl 形如 https://你的worker.dev/ai-analyze
  // 返回 { ok:true, result:"分析文本", model:"...", usage:{...} } 或 { ok:false, error:"..." }
  function fetchAIAnalysis(proxyUrl, payload) {
    if (!proxyUrl) return Promise.reject(new Error('未配置 AI 分析代理地址'));
    return fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('AI 代理返回 ' + r.status);
      return r.json();
    }).then(function (d) {
      if (d && d.error) throw new Error(d.error);
      return d;
    });
  }

  global.VHAPI = {
    fetchExchangeRates: fetchExchangeRates,
    fetchDiscogs: fetchDiscogs,
    fetchDiscogsRelease: fetchDiscogsRelease,
    fetchJson: fetchJson,
    fetchMusicBrainzNews: fetchMusicBrainzNews,
    fetchChinaHotWords: fetchChinaHotWords,
    fetchAIAnalysis: fetchAIAnalysis
  };
})(window);
