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
            limited: special
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

  global.VHAPI = {
    fetchExchangeRates: fetchExchangeRates,
    fetchDiscogs: fetchDiscogs,
    fetchDiscogsRelease: fetchDiscogsRelease,
    fetchJson: fetchJson
  };
})(window);
