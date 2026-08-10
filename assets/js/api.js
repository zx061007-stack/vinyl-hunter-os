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

  // Discogs 数据库查询（需要用户在系统设置填写 Discogs Token）
  function fetchDiscogs(query, token) {
    if (!token) throw new Error('缺少 Discogs Token');
    var url = 'https://api.discogs.com/database/search?q=' +
      encodeURIComponent(query) + '&type=release&per_page=15&token=' + encodeURIComponent(token);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('Discogs API ' + r.status);
      return r.json();
    }).then(function (d) {
      return (d.results || []).map(function (it) {
        var title = (it.title || '').split(' - ');
        var labels = it.labels || [];
        return {
          artist: (title[0] || '').trim(),
          album: (title.slice(1).join(' - ') || '').trim(),
          catalog: (labels[0] && labels[0].catno) || '',
          label: (labels[0] && labels[0].name) || '',
          year: it.year || '',
          country: it.country || '',
          version: (it.format || []).join(','),
          marketPrice: (it.community && it.community.price && it.community.price.suggested) || '',
          link: it.uri || '',
          cover: it.cover_image || ''
        };
      });
    });
  }

  // 通用 JSON 获取（用户自行配置的资讯源 / 热点源 / 价格源）
  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('接口返回 ' + r.status);
      return r.json();
    });
  }

  global.VHAPI = {
    fetchExchangeRates: fetchExchangeRates,
    fetchDiscogs: fetchDiscogs,
    fetchJson: fetchJson
  };
})(window);
