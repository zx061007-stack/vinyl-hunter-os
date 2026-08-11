/* ============================================================
 * Vinyl Hunter OS — 应用主逻辑 (app.js)
 * 左侧固定导航 + 右侧内容区；所有数据本地持久化（IndexedDB）。
 * 全部「采集 / 更新 / 刷新」均为用户点击按钮后触发，绝不自动联网。
 * UI：米白 / 暖灰 / 墨绿 / 复古橙，护眼、耐看、长期使用不疲劳。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- 基础工具 ---------------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function elFrom(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtMoney(n) {
    n = Number(n) || 0;
    return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function monthStr(d) { return (d || todayStr()).slice(0, 7); }

  var toastTimer = null;
  function toast(msg, type) {
    var box = $('#toast');
    var m = elFrom('<div class="toast-msg ' + (type || '') + '">' + esc(msg) + '</div>');
    box.appendChild(m);
    setTimeout(function () { m.style.opacity = '0'; m.style.transition = 'opacity .3s'; }, 2600);
    setTimeout(function () { if (m.parentNode) m.parentNode.removeChild(m); }, 3000);
  }

  // 读取图片文件为 DataURL（用于真假鉴定的封面/外包装/标签图片，本地保存）
  function readFileAsDataURL(file) {
    return new Promise(function (resolve) {
      if (!file) return resolve('');
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { resolve(''); };
      fr.readAsDataURL(file);
    });
  }

  /* ---------------- 导航配置（16 个模块） ---------------- */
  var NAV = [
    { id: 'dashboard', label: '首页驾驶舱', icon: '🏠' },
    { id: 'datahub', label: '数据采集中心', icon: '🛰️' },
    { id: 'websites', label: '🔗唱片网址', icon: '🔗' },
    { id: 'discogs', label: 'Discogs黑胶数据库', icon: '💿' },
    { id: 'auth', label: '黑胶真假鉴定助手', icon: '🔍' },
    { id: 'analysis', label: '黑胶全分析', icon: '📊' },
    { id: 'profit', label: '黑胶利润计算器', icon: '🧮' },
    { id: 'inventory', label: '黑胶库存管理', icon: '📦' },
    { id: 'hot', label: '每日热点', icon: '🔥' },
    { id: 'musicnews', label: '音乐新信息', icon: '🎵' },
    { id: 'fx', label: '实时汇率', icon: '💲' },
    { id: 'expense', label: '消费记账', icon: '💰' },
    { id: 'crm', label: '客户CRM', icon: '👥' },
    { id: 'plan', label: '每日计划', icon: '✅' },
    { id: 'aiusage', label: 'AI使用记录', icon: '📈' },
    { id: 'backup', label: '数据备份中心', icon: '💾' },
    { id: 'settings', label: '系统设置', icon: '⚙️' }
  ];

  /* ---------------- 采集封装（仅按钮触发） ---------------- */
  function collectFx() {
    return VHAPI.fetchExchangeRates().then(function (data) {
      return VHDB.put('exchange_rates', { date: data.date, rates: data.rates }).then(function () {
        toast('汇率已更新（' + data.date + '）', 'ok');
      });
    });
  }
  function collectMusicNews() {
    return VHDB.getConfig().then(function (cfg) {
      // 优先走 Worker 代理（全网数据：MusicBrainz + iTunes，含预售价格，海内外覆盖）
      // 用户也可在系统设置填 musicNewsSource 自定义源覆盖
      var p = cfg.musicNewsSource
        ? VHAPI.fetchJson(cfg.musicNewsSource).then(function (data) {
            return Array.isArray(data) ? data : (data.items || data.releases || []);
          })
        : VHAPI.fetchMusicBrainzNews(cfg.chinaHotProxy);
      return p.then(function (items) {
        return VHDB.put('music_news', { date: todayStr(), items: items }).then(function () {
          toast('已采集 ' + items.length + ' 条音乐资讯（全网·海内外）', 'ok');
        });
      });
    });
  }
  // 平台 App 跳转链接（工作台内一键跳转到该平台 App 查看）
  function platformAppLink(platform, keyword) {
    var q = encodeURIComponent(keyword || '');
    var map = {
      weibo: 'sinaweibo://search/all?q=' + q,
      douyin: 'snssdk1128://search?keyword=' + q,
      bilibili: 'bilibili://search?keyword=' + q,
      xiaohongshu: 'xhsdiscover://search/result?keyword=' + q
    };
    return map[platform] || '';
  }
  function platformWebLink(platform, keyword) {
    var q = encodeURIComponent(keyword || '');
    var map = {
      weibo: 'https://s.weibo.com/weibo?q=' + q,
      douyin: 'https://www.douyin.com/search/' + q,
      bilibili: 'https://search.bilibili.com/all?keyword=' + q,
      xiaohongshu: 'https://www.xiaohongshu.com/search_result?keyword=' + q
    };
    return map[platform] || '';
  }

  /* ---------------- 通用记录管理组件 ---------------- */
  function createRecordManager(cfg) {
    var node = elFrom(
      '<div class="module">' +
      '  <div class="mod-head"><h2>' + esc(cfg.title) + '</h2>' +
      '    <div class="mod-actions">' +
      (cfg.collect ? '<button class="btn btn-collect" id="collectBtn">🔄 ' + esc(cfg.collect.label) + '</button>' : '') +
      '      <button class="btn btn-primary" id="addBtn">＋ 新增</button>' +
      '    </div></div>' +
      '  <div class="form-wrap hidden" id="formWrap"></div>' +
      '  <div class="list-wrap" id="listWrap"><div class="empty">加载中…</div></div>' +
      (cfg.ai ? aiSectionHTML(cfg.ai) : '') +
      '</div>'
    );
    var listWrap = node.querySelector('#listWrap');
    var formWrap = node.querySelector('#formWrap');
    var editingId = null;

    function fieldHTML(f, val) {
      val = (val == null ? '' : val);
      if (f.t === 'textarea') return '<label class="full">' + esc(f.l) + '<textarea name="' + f.k + '">' + esc(val) + '</textarea></label>';
      if (f.t === 'select') {
        return '<label>' + esc(f.l) + '<select name="' + f.k + '">' +
          (f.opts || []).map(function (o) { return '<option value="' + esc(o) + '"' + (o === val ? ' selected' : '') + '>' + esc(o || '—') + '</option>'; }).join('') +
          '</select></label>';
      }
      var type = f.t === 'number' ? 'number" step="any' : 'text';
      return '<label>' + esc(f.l) + '<input type="' + type + '" name="' + f.k + '" value="' + esc(val) + '"></label>';
    }

    function buildForm(item) {
      item = item || {};
      var html = '<form class="rec-form" id="recForm">';
      cfg.fields.forEach(function (f) { html += fieldHTML(f, item[f.k]); });
      html += '<div class="form-btns"><button type="submit" class="btn btn-primary">保存</button>' +
        '<button type="button" class="btn" id="cancelBtn">取消</button></div></form>';
      formWrap.innerHTML = html;
      formWrap.classList.remove('hidden');
      var form = formWrap.querySelector('#recForm');
      form.onsubmit = function (e) {
        e.preventDefault();
        var data = {};
        cfg.fields.forEach(function (f) {
          var v = form.elements[f.k].value;
          if (f.t === 'number') v = v === '' ? '' : Number(v);
          data[f.k] = v;
        });
        if (editingId != null) data.id = editingId;
        if (cfg.derive) cfg.derive(data);
        save(data);
      };
      formWrap.querySelector('#cancelBtn').onclick = function () { formWrap.classList.add('hidden'); editingId = null; };
    }

    function save(data) {
      var p = data.id ? VHDB.put(cfg.store, data) : VHDB.add(cfg.store, data);
      p.then(function () { toast('已保存', 'ok'); formWrap.classList.add('hidden'); editingId = null; refresh(); })
        .catch(function (e) { toast('保存失败：' + e.message, 'err'); });
    }

    function renderList(rows) {
      if (!rows.length) { listWrap.innerHTML = '<div class="empty">暂无数据，点击「新增」或「采集」开始记录。</div>'; return; }
      var cols = cfg.cols || cfg.fields.map(function (f) { return f.k; });
      var head = cols.map(function (c) {
        var f = cfg.fields.find(function (x) { return x.k === c; });
        return '<th>' + esc(f ? f.l : c) + '</th>';
      }).join('');
      head += (cfg.derive ? '<th>评分 / 结果</th>' : '') + '<th>操作</th>';
      var body = rows.map(function (r) {
        var tds = cols.map(function (c) {
          var f = cfg.fields.find(function (x) { return x.k === c; });
          var v = r[c];
          if (f && f.tag) return '<td><span class="tag">' + esc(v) + '</span></td>';
          return '<td>' + esc(v) + '</td>';
        }).join('');
        if (cfg.derive) { var d = Object.assign({}, r); cfg.derive(d); tds += '<td>' + esc(d._summary || '') + '</td>'; }
        tds += '<td class="row-actions"><button class="btn btn-sm" data-edit="' + r.id + '">编辑</button>' +
          '<button class="btn btn-sm btn-danger" data-del="' + r.id + '">删除</button></td>';
        return '<tr>' + tds + '</tr>';
      }).join('');
      listWrap.innerHTML = '<div class="table-scroll"><table class="rec-table"><thead><tr>' + head +
        '</tr></thead><tbody>' + body + '</tbody></table></div>';
      $$('[data-edit]', listWrap).forEach(function (b) {
        b.onclick = function () {
          var it = rows.find(function (r) { return r.id == b.dataset.edit; });
          editingId = it.id; buildForm(it); window.scrollTo({ top: 0, behavior: 'smooth' });
        };
      });
      $$('[data-del]', listWrap).forEach(function (b) {
        b.onclick = function () {
          if (confirm('确认删除该记录？')) {
            VHDB.del(cfg.store, Number(b.dataset.del)).then(function () { toast('已删除'); refresh(); });
          }
        };
      });
    }

    function refresh() { VHDB.getAll(cfg.store).then(renderList); }

    if (cfg.collect) {
      var cb = node.querySelector('#collectBtn');
      cb.onclick = function () {
        cb.disabled = true; var old = cb.textContent; cb.textContent = '采集中…';
        cfg.collect.fn().then(function () { refresh(); }).catch(function (e) { toast('采集失败：' + e.message, 'err'); })
          .then(function () { cb.disabled = false; cb.textContent = old; refresh(); });
      };
    }
    node.querySelector('#addBtn').onclick = function () { editingId = null; buildForm({}); };

    // 清空按钮：清除本模块全部录入数据（不删其他模块）
    addClearButton(node, '🗑 清空', function () { return VHDB.clear(cfg.store); });

    if (cfg.ai) bindAI(node, cfg.ai);
    return { node: node, refresh: refresh };
  }

  /* ---------------- 派生计算（评分 / 利润 / 套利） ---------------- */
  // 选品评分：热度由系统自动估算（无需用户输入），利润 + 热度 + 收藏价值
  // 黑胶全分析：综合评分引擎（本地确定性算法，不消耗 Token）
  // 输入 d 需含：name/artist/catalog/version/versionInfo/year/company/country
  //   可选 Discogs 社区数据：want/have/numForSale
  //   用户填写：buyPrice（购入价）/presalePrice（预售价）
  // 输出：versionValue/overseasHot(+level/text)/chinaHot(+level/text/ platforms)/collectValue/
  //       score/level/profit/margin/advice/reason
  function analyzeVinyl(d, hotData) {
    var buy = Number(d.buyPrice) || 0;
    var sell = Number(d.presalePrice) || 0;

    // 一、版本价值（基于版本描述关键词）
    var vp = ((d.version || '') + ' ' + (d.versionInfo || '')).toLowerCase();
    var vLimited = /limited|限量|numbered/.test(vp);
    var vFirst = /first|首版|original/.test(vp);
    var vColor = /colou?r|picture disc|彩胶/.test(vp);
    var vWeight = (/(\d{3})\s?g/.exec(vp) || [])[0];
    var versionValue = 55;
    if (vLimited) versionValue += 20;
    if (vFirst) versionValue += 18;
    if (vColor) versionValue += 12;
    if (vWeight && parseInt(vWeight, 10) >= 180) versionValue += 8;
    versionValue = clamp(versionValue, 0, 100);

    // 二、海外热度（有 Discogs 社区数据则数据驱动，否则按版本属性估算）
    var want = Number(d.want) || 0, have = Number(d.have) || 0, numForSale = Number(d.numForSale) || 0;
    var overseasHot, overseasText;
    if (want || have || numForSale) {
      var heat = 45;
      if (want >= 2000) heat = 95; else if (want >= 1000) heat = 85; else if (want >= 500) heat = 76;
      else if (want >= 200) heat = 66; else if (want >= 80) heat = 56; else heat = 48;
      if (numForSale === 0) heat += 12; else if (numForSale < 10) heat += 9; else if (numForSale < 30) heat += 4;
      if (vLimited) heat += 6; if (vColor) heat += 4;
      overseasHot = clamp(heat, 0, 100);
      var scarcity = numForSale === 0 ? '在售 0 张（极稀缺）' : ('在售约 ' + numForSale + ' 张');
      overseasText = '海外需求频率（Discogs 社区数据）：收藏者想买(want) ' + (want || '-') + ' 人，已拥有(have) ' + (have || '-') + ' 人，' + scarcity + '。' +
        (overseasHot >= 75 ? '海外需求频率高，版本抢手。' : overseasHot >= 60 ? '海外有一定需求频率。' : '海外需求频率一般。');
    } else {
      var h = 60;
      if (vLimited) h += 20; if (vFirst) h += 12; if (vColor) h += 8;
      overseasHot = clamp(h, 0, 100);
      overseasText = '未获取到 Discogs 社区数据，' +
        (overseasHot >= 75 ? '依据版本稀缺属性（限量/首版/彩胶）判断海外需求频率较高。' : '依据版本属性判断海外需求频率中等或一般。');
    }
    var overseasLevel = overseasHot >= 75 ? '高' : overseasHot >= 60 ? '中' : '低';

    // 三、中国热度（4平台分采：微博/抖音/B站/小红书，按歌手/厂牌/专辑名匹配）
    var estBase = clamp(Math.round(overseasHot * 0.82 + (vLimited ? 6 : 0) + (vFirst ? 4 : 0) - 6), 30, 95);
    // hotData 可以是 { platforms:{}, words:[] } 或旧格式数组
    var hotPlatforms = (hotData && hotData.platforms) ? hotData.platforms : {};
    var hotWords = (hotData && Array.isArray(hotData.words)) ? hotData.words : (Array.isArray(hotData) ? hotData : []);
    var chinaHot, chinaText, chinaSource, chinaPlatforms = {};
    var platformLabels = { weibo:'微博', douyin:'抖音', bilibili:'B站', xiaohongshu:'小红书' };
    if (hotWords.length || Object.keys(hotPlatforms).length) {
      // 用歌手 / 厂牌（识别度高的实体）以及专辑名显著词去匹配热搜
      var keywords = [d.artist, d.company].filter(function (k) { return k && String(k).trim().length >= 2; })
        .map(function (k) { return String(k).trim(); })
        .concat(String(d.name || '').split(/[\s\-–—/]+/).filter(function (w) { return w.length >= 3; }));
      var allHits = [];
      var totalMatched = 0;

      // 分平台匹配
      Object.keys(hotPlatforms).forEach(function (p) {
        if (p === 'xianyu') return; // 闲鱼已移除
        var pWords = hotPlatforms[p] || [];
        var pHits = [];
        pWords.forEach(function (w) {
          keywords.forEach(function (k) {
            if (w && (w.indexOf(k) >= 0 || k.indexOf(w) >= 0) && pHits.indexOf(k) < 0) pHits.push(k);
          });
        });
        chinaPlatforms[p] = { total: pWords.length, hits: pHits, sample: pWords.slice(0, 10) };
        pHits.forEach(function (k) { if (allHits.indexOf(k) < 0) allHits.push(k); });
        if (pHits.length) totalMatched++;
      });

      // 如果没有分平台数据，回退到合并数组匹配
      if (!Object.keys(hotPlatforms).length && hotWords.length) {
        var legacyHits = [];
        hotWords.forEach(function (w) {
          keywords.forEach(function (k) {
            if (w && (w.indexOf(k) >= 0 || k.indexOf(w) >= 0) && legacyHits.indexOf(k) < 0) legacyHits.push(k);
          });
        });
        allHits = legacyHits;
      }

      var base = clamp(Math.round(overseasHot * 0.7 + (vLimited ? 6 : 0) + (vFirst ? 4 : 0) - 6), 30, 92);
      // 搜索次数统计文本
      var searchCountText = Object.keys(hotPlatforms).filter(function(p) { return p !== 'xianyu'; }).map(function (p) {
        return platformLabels[p] + ' ' + (hotPlatforms[p] || []).length + '条';
      }).join(' / ');

      if (allHits.length) {
        // 命中平台数越多加成越高
        var platformBonus = totalMatched >= 3 ? 12 : totalMatched >= 2 ? 8 : totalMatched >= 1 ? 5 : 0;
        var hitBonus = allHits.length >= 3 ? 35 : allHits.length === 2 ? 28 : 18;
        chinaHot = clamp(base + hitBonus + platformBonus, 30, 100);
        var platformNames = Object.keys(hotPlatforms).filter(function (p) { return p !== 'xianyu' && (chinaPlatforms[p] || {}).hits && chinaPlatforms[p].hits.length; });
        chinaSource = platformNames.length ? (platformNames.map(function (p) {
          return platformLabels[p] || p;
        }).join('/') + '热搜命中') : '热搜命中';
        chinaText = '基于4平台热搜数据（搜索次数：' + searchCountText + '）匹配到关键词：' + allHits.join('、') +
          '。命中 ' + totalMatched + ' 个平台（' + platformNames.map(function (p) {
            return platformLabels[p] + ':' + (chinaPlatforms[p].hits.join(','));
          }).join('；') + '）。中国社交平台讨论热度高，粉丝需求与收藏市场预期强。';
      } else {
        chinaHot = clamp(base, 30, 95);
        chinaSource = '4平台热搜（未命中）';
        chinaText = '已接入4平台热搜数据（搜索次数：' + (searchCountText || '共 ' + hotWords.length + ' 条') + '），未匹配到该艺人/厂牌，结合版本稀缺度与海外需求频率推算中国市场需求中等或有限。';
      }
    } else {
      chinaHot = estBase;
      chinaSource = '参考估算（未配置热搜代理）';
      chinaText = '（参考估算）未配置中国热搜代理地址，基于海外需求频率与版本稀缺度推算。如需真实中国热度，请在系统设置填写热搜代理地址。' +
        (chinaHot >= 75 ? '中国粉丝需求与收藏市场预期较高。' : chinaHot >= 60 ? '中国市场需求中等。' : '中国市场认知度与需求相对有限。');
    }
    var chinaLevel = chinaHot >= 75 ? '高' : chinaHot >= 60 ? '中' : '低';

    // 四、收藏价值
    var scarcityScore = (want && have) ? clamp(Math.round(want / Math.max(have, 1) * 40 + (numForSale < 20 ? 30 : 10)), 0, 100) : versionValue;
    var collectValue = clamp(Math.round(versionValue * 0.6 + scarcityScore * 0.4), 0, 100);

    // 五、价值评分（0-100）
    var score = Math.round(0.35 * overseasHot + 0.25 * chinaHot + 0.25 * versionValue + 0.15 * collectValue);
    var level = score >= 90 ? '强烈推荐' : score >= 75 ? '推荐关注' : score >= 60 ? '谨慎考虑' : '不建议采购';

    // 六、利润分析
    var profit = sell - buy;
    var margin = buy > 0 ? (profit / buy * 100) : 0;

    // 七、最终购买建议
    var advice;
    if (score >= 75 && profit > 0) advice = '推荐购买';
    else if (score >= 60 && profit >= 0) advice = '谨慎购买';
    else advice = '不建议购买';

    var verdictWord = buy > 0
      ? ('当前采购成本 ' + fmtMoney(buy) + ' 元，预计售价 ' + fmtMoney(sell) + ' 元，' +
        (profit > 0 ? ('预计利润 ' + fmtMoney(profit) + ' 元（利润率 ' + margin.toFixed(1) + '%），') : '利润为负，'))
      : '尚未填写购入价格，';
    var versionDesc = (vLimited || vFirst || vColor) ? ('具收藏价值（' + [vLimited ? '限量' : null, vFirst ? '首版' : null, vColor ? '彩胶' : null].filter(Boolean).join('/') + '）') : '收藏价值一般';
    var reason = '该黑胶海外需求频率' + overseasLevel + '（' + (want ? ('Discogs want ' + want) : '版本属性推算') + '），' +
      '中国热度' + chinaLevel + '（' + chinaSource + '），版本' + versionDesc + '。' +
      verdictWord + (profit > 0 ? '具有套利空间' : (buy > 0 ? '暂无明显套利空间' : '无法判断利润')) +
      '。综合评分 ' + score + '（' + level + '），建议' + advice + '。';

    d.versionValue = versionValue;
    d.overseasHot = overseasHot; d.overseasLevel = overseasLevel; d.overseasText = overseasText;
    d.chinaHot = chinaHot; d.chinaLevel = chinaLevel; d.chinaText = chinaText; d.chinaSource = chinaSource; d.chinaPlatforms = chinaPlatforms;
    d.collectValue = collectValue;
    d.score = score; d.level = level;
    d.profit = profit; d.margin = margin;
    d.advice = advice; d.reason = reason;
    return d;
  }
  // 利润计算器：显式拆分 国际邮费 / 国内邮费 / 打包费 / 赠品费 / 其他费用
  function deriveProfit(d) {
    var cost = (Number(d.buyPrice) || 0) + (Number(d.intlShip) || 0) + (Number(d.domesticShip) || 0) +
      (Number(d.packFee) || 0) + (Number(d.giftFee) || 0) + (Number(d.otherFee) || 0);
    var profit = (Number(d.sellPrice) || 0) - cost;
    var margin = cost > 0 ? profit / cost * 100 : 0;
    var advice = margin >= 50 ? '推荐购买' : margin >= 20 ? '谨慎购买' : '不建议购买';
    d.cost = cost; d.profit = profit; d.margin = margin; d.advice = advice;
    d._summary = '成本 ' + fmtMoney(cost) + ' · 利润 ' + fmtMoney(profit) + ' · 利润率 ' + margin.toFixed(1) + '% · ' + advice;
  }

  /* ---------------- 记录模块配置（精简后保留） ---------------- */
  var RECORD_CONFIGS = {
    profit: {
      title: '黑胶利润计算器', store: 'profit_calcs', derive: deriveProfit,
      fields: [
        { k: 'buyPrice', l: '购买价格', t: 'number' },
        { k: 'intlShip', l: '国际邮费', t: 'number' },
        { k: 'domesticShip', l: '国内邮费', t: 'number' },
        { k: 'packFee', l: '打包费', t: 'number' },
        { k: 'giftFee', l: '赠品费', t: 'number' },
        { k: 'otherFee', l: '其他费用', t: 'number' },
        { k: 'sellPrice', l: '预计售价', t: 'number' }
      ],
      cols: ['buyPrice', 'sellPrice']
    },
    expense: {
      title: '消费记账', store: 'expenses', ai: 'expense',
      fields: [
        { k: 'date', l: '日期', t: 'text' },
        { k: 'amount', l: '金额', t: 'number' },
        { k: 'note', l: '备注', t: 'textarea' }
      ],
      cols: ['date', 'amount', 'note']
    },
  };
  // 注：discogs / inventory / crm 已改为自定义联动模块（见 buildDiscogs / buildInventory / buildCrm），
  // 不再使用通用 createRecordManager。

  /* ==================== AI 智能分析系统（全局） ====================
   * 所有 AI 分析必须由用户点击【AI分析】按钮触发。
   * 禁止：自动分析、后台运行、打开页面自动调用——避免 Token 浪费。
   * 配置了「AI分析代理地址」→ 通过 Worker 调真实 AI（DeepSeek 等），Key 在 Worker 端。
   * 未配置 → 走本地确定性分析（不消耗 Token，结果明确标注数据来源）。
   * 所有结果永久保存到 IndexedDB（ai_analyses 仓库），刷新/关浏览器不丢失。
   * =================================================================== */

  // 统一7段式输出格式模板
  function aiFormat(subject, verdict, score, pros, risks, action, nextStep) {
    var s = '【分析对象】\n' + subject + '\n\n';
    s += '【核心判断】\n' + verdict + '\n\n';
    s += '【评分】\n' + score + '\n\n';
    s += '【优势】\n' + pros + '\n\n';
    s += '【风险】\n' + risks + '\n\n';
    s += '【建议】\n' + action + '\n\n';
    s += '【下一步行动】\n' + nextStep;
    return s;
  }
  // 统一 AI system prompt 后缀
  var AI_FORMAT_SUFFIX = '\n\n请严格按以下7段式格式输出：\n【分析对象】\n【核心判断】\n【评分】\n【优势】\n【风险】\n【建议】\n【下一步行动】';

  var AI_CONFIGS = {
    plan: {
      label: 'AI分析今日执行情况',
      collect: function () {
        return VHDB.get('daily_plans', todayStr()).then(function (rec) {
          return rec || { date: todayStr(), tasks: [] };
        });
      },
      prompt: function (d) {
        return {
          system: '你是黑胶商业工作台的AI助手。分析用户今日计划执行情况，输出：任务完成率、完成习惯、执行效率、拖延问题、下一步优化建议。' + AI_FORMAT_SUFFIX,
          user: '今日计划数据：\n' + JSON.stringify(d, null, 2)
        };
      },
      local: function (d) {
        var tasks = d.tasks || [];
        var done = tasks.filter(function (t) { return t.done; }).length;
        var rate = tasks.length ? Math.round(done / tasks.length * 100) : 0;
        var pending = tasks.filter(function (t) { return !t.done; }).map(function (t) { return '· ' + t.text; }).join('\n');
        return aiFormat(
          '今日计划执行情况（' + todayStr() + '）',
          '完成任务 ' + done + '/' + tasks.length + '，完成率 ' + rate + '%。' + (rate >= 80 ? '执行率优秀。' : rate >= 50 ? '执行率中等，部分需跟进。' : '执行率偏低，需关注拖延。'),
          '执行评分：' + rate + '/100',
          rate >= 50 ? '· 已完成' + done + '项任务\n· 保持了工作节奏' : '· 已开始执行部分任务',
          (pending ? '· 未完成任务：\n' + pending : '· 无拖延任务') + '\n· ' + (tasks.length > 8 ? '任务偏多，影响聚焦' : '任务数量适中'),
          rate >= 80 ? '保持当前节奏，适当增加黑胶采购任务' : '将大任务拆分，习惯类优先安排早晨，每日复盘未完成原因',
          '· 明日优先安排高价值任务\n· 习惯类任务保持连续性\n· 每周回顾完成率趋势'
        );
      }
    },
    websites: {
      label: 'AI整理网站',
      collect: function () { return VHDB.getAll('websites'); },
      prompt: function (d) {
        return {
          system: '你是黑胶商业工作台的AI助手。分析用户收藏的黑胶网站，输出：网站类型统计、用途分类、推荐分类、是否重复、哪些最适合购买、哪些适合查询。' + AI_FORMAT_SUFFIX,
          user: '网站收藏数据：\n' + JSON.stringify(d.map(function (w) { return { name: w.name, url: w.url, category: w.category, note: w.note }; }), null, 2)
        };
      },
      local: function (rows) {
        var cats = {};
        rows.forEach(function (r) { var c = r.category || '未分类'; cats[c] = (cats[c] || 0) + 1; });
        var buySites = rows.filter(function (r) { return /购买|平台|mercari|ebay|淘宝|闲鱼/i.test(r.category + r.name + r.url); });
        var querySites = rows.filter(function (r) { return /查询|资料|discogs/i.test(r.category + r.name + r.url); });
        var dups = [];
        var urls = {};
        rows.forEach(function (r) { var u = (r.url || '').replace(/\/$/, ''); if (urls[u]) dups.push(r.name + ' 与 ' + urls[u]); else urls[u] = r.name; });
        return aiFormat(
          '黑胶网站收藏整理（共' + rows.length + '个）',
          '收藏' + rows.length + '个网站，覆盖' + Object.keys(cats).length + '个分类。购买平台' + buySites.length + '个，资料查询' + querySites.length + '个。',
          '网站丰富度：' + clamp(rows.length * 10, 0, 100) + '/100',
          '· 覆盖购买/查询/资讯多维度\n· 分类：' + Object.keys(cats).map(function(c) { return c + '(' + cats[c] + ')'; }).join('、'),
          (dups.length ? '· 发现重复：' + dups.join('；') : '· 无重复网站') + '\n· ' + (buySites.length < 2 ? '购买平台偏少' : '购买平台充足'),
          buySites.length ? '优先使用购买平台比价，关注Mercari/eBay低价黑胶' : '建议添加购买平台网站（Mercari、eBay等）',
          '· 购买前在Discogs查询版本信息\n· 定期清理重复网站\n· 补充资讯类网站获取行业动态'
        );
      }
    },
    discogs: {
      label: 'AI分析专辑价值',
      collect: function (extra) { return Promise.resolve(extra || {}); },
      prompt: function (d) {
        return {
          system: '你是黑胶收藏与交易专家。根据专辑信息分析：1.版本价值（首版价值、再版价值、限定版本价值）2.收藏价值（稀缺程度、收藏意义、长期价值）3.市场定位（适合收藏、适合出售、适合套利）。输出收藏价值评分、版本分析、购买建议。' + AI_FORMAT_SUFFIX,
          user: '专辑信息：\n' + JSON.stringify(d, null, 2)
        };
      },
      local: function (d) {
        var v = (d.version || '').toLowerCase();
        var scarce = [];
        if (/limited|限量|numbered/.test(v)) scarce.push('限量版');
        if (/first|首版/.test(v)) scarce.push('首版');
        if (/colou?r|picture|彩胶/.test(v)) scarce.push('彩胶');
        var ratio = d.want && d.have ? d.want / d.have : 0;
        var collectScore = clamp((scarce.length * 25) + (ratio > 2 ? 30 : ratio > 1 ? 15 : 5) + (d.numForSale < 10 ? 15 : 5), 0, 100);
        return aiFormat(
          (d.artist || '-') + ' — ' + (d.album || d.name || '-') + '（' + (d.catalog || '-') + '）',
          scarce.length >= 2 ? '版本稀缺度高，' + (ratio > 2 ? '市场需求旺盛，推荐收藏' : '有一定需求，可藏可交易') : '普通版本，' + (ratio > 1 ? '有需求但稀缺度一般' : '供需平衡，适合交易流转'),
          '收藏价值：' + collectScore + '/100（' + (collectScore >= 75 ? '★★★★★' : collectScore >= 60 ? '★★★★☆' : collectScore >= 45 ? '★★★☆☆' : '★★☆☆☆') + '）',
          (scarce.length ? '· 版本特征：' + scarce.join(' · ') + '\n' : '') + '· 社区关注度：want ' + (d.want || '-') + ' / have ' + (d.have || '-') + (ratio > 1 ? '\n· 需求大于供给' : ''),
          (d.numForSale === 0 ? '· 在售0张，流动性风险' : '· 在售' + d.numForSale + '张') + '\n· ' + (scarce.length < 2 ? '版本稀缺度低，升值空间有限' : '稀缺但流通性需关注'),
          scarce.length >= 2 || ratio > 2 ? '推荐收藏·长期持有' : scarce.length >= 1 || ratio > 1 ? '可收藏可交易，关注价格波动' : '适合交易流转，关注利润空间',
          (scarce.length >= 2 ? '· 长期持有，等待升值\n' : '') + '· 可点击【进入黑胶全分析】做深度分析\n· 可点击【保存到库存】入库管理'
        );
      }
    },
    auth: {
      label: 'AI辅助鉴定',
      collect: function (extra) { return Promise.resolve(extra || {}); },
      prompt: function (d) {
        return {
          system: '你是黑胶鉴定专家。根据专辑信息、编号、版本、图片描述分析：1.编号是否匹配 2.版本是否一致 3.包装是否合理 4.图片是否存在异常。输出真实性参考评分（0-100分）、风险等级（低风险/中风险/高风险）、购买建议（建议购买/需要确认/谨慎购买）、购买检查清单。注意：AI鉴定仅作为辅助参考。' + AI_FORMAT_SUFFIX,
          user: '鉴定数据：\n' + JSON.stringify(d, null, 2)
        };
      },
      local: function (d) {
        var checks = d.checks || [];
        var score = 0;
        var weights = { catalogOk: 22, labelOk: 18, priceOk: 16, printOk: 16, sellerOk: 14, imgOk: 14 };
        checks.forEach(function (k) { score += weights[k] || 0; });
        var level = score >= 90 ? '低风险' : score >= 70 ? '中风险' : '高风险';
        var advice = score >= 90 ? '建议购买' : score >= 70 ? '需要确认' : '谨慎购买';
        return aiFormat(
          (d.album || d.catalog || '鉴定记录') + '（Catalog: ' + (d.catalog || '-') + '）',
          '真实性参考评分 ' + score + '/100，' + level + '。' + advice + '。',
          '真实性评分：' + score + '/100（' + level + '）',
          checks.map(function(k) { return '· ' + ({catalogOk:'编号匹配',labelOk:'版本一致',priceOk:'价格正常',printOk:'印刷正常',sellerOk:'卖家信誉好',imgOk:'已上传照片'}[k] || k); }).join('\n') || '· 暂无通过项',
          [!checks.length ? '· 未勾选任何核对项' : '', checks.indexOf('catalogOk') < 0 ? '· 编号未确认' : '', checks.indexOf('priceOk') < 0 ? '· 价格可能异常' : '', !d.coverImg ? '· 缺少实物照片' : ''].filter(Boolean).join('\n'),
          advice + '。' + (score < 90 ? '建议补充核对项后再决定。' : '可放心采购。'),
          '· ⚠️ AI鉴定仅辅助参考，最终以实物为准\n· 可点击【AI鉴定检查清单】获取完整检查项'
        );
      }
    },
    auth_checklist: {
      label: 'AI鉴定检查清单',
      collect: function (extra) { return Promise.resolve(extra || {}); },
      prompt: function (d) {
        return {
          system: '你是黑胶鉴定专家。根据专辑信息生成购买前需要检查的完整清单，包括编号、包装、印刷、音质、卖家等方面。用中文，结构清晰。' + AI_FORMAT_SUFFIX,
          user: '专辑信息：\n' + JSON.stringify(d, null, 2)
        };
      },
      local: function (d) {
        return aiFormat(
          (d.album || d.catalog || '黑胶') + ' — 购买前检查清单',
          '生成购买前必查清单，涵盖编号、包装、印刷、音质、卖家5大维度',
          '完整度：100/100（5维度全覆盖）',
          '· 覆盖核心鉴别点\n· 可逐项勾选核对\n· 降低购买风险',
          '· 仍有主观判断成分\n· 部分项目需实物才能确认',
          '逐项核对清单，全部通过后再购买',
          '【编号检查】\n· Catalog Number与Discogs官方记录一致\n· Matrix/Runout编号与官方版本匹配\n· 条形码(ISBN/UPC)可查询\n\n【包装检查】\n· 封套印刷清晰无错版\n· 内页/歌词本完整\n· 封套颜色与官方版本一致\n· 塑料封膜完好（如有）\n\n【印刷检查】\n· 唱片标签印刷清晰\n· 中心孔位置准确\n· 无明显印刷偏移或重影\n\n【音质检查】\n· 唱片表面无明显划痕\n· 无 warp（翘曲）\n· 音轨间距均匀\n\n【卖家检查】\n· 卖家信誉评分>95%\n· 有实物照片（非官方图）\n· 价格在市场合理区间\n· 退换货政策明确'
        );
      }
    },
    analysis: {
      label: '开始AI分析',
      collect: function (extra) { return Promise.resolve(extra || {}); },
      prompt: function (d) {
        return {
          system: '你是黑胶采购决策专家。综合分析以下5个维度：1.海外热度（海外收藏关注、市场需求、版本稀缺）2.中国热度（国内粉丝需求、社交平台讨论）3.收藏价值（歌手影响力、版本价值、发行年份）4.利润分析（预计利润=预售价格-购入价格，利润率=利润÷购入价格）5.风险分析（价格风险、市场风险、流通风险）。输出0-100综合评分，评分等级（90-100推荐采购/70-90可以考虑/70以下谨慎采购），最终建议（买入/观察/放弃）。' + AI_FORMAT_SUFFIX,
          user: '分析数据：\n' + JSON.stringify(d, null, 2)
        };
      },
      local: function (d) {
        var buy = Number(d.buyPrice) || 0, sell = Number(d.presalePrice) || 0;
        var profit = sell - buy;
        var margin = buy > 0 ? profit / buy * 100 : 0;
        var want = d.want || 0, have = d.have || 0, nfs = d.numForSale || 0;
        var overseas = want > 100 ? 80 : want > 50 ? 65 : want > 20 ? 50 : 40;
        var china = Math.round(overseas * 0.82);
        var v = (d.version || '').toLowerCase();
        var cv = 60;
        if (/limited|限量/.test(v)) cv += 20;
        if (/first|首版/.test(v)) cv += 20;
        if (/colou?r|picture|彩胶/.test(v)) cv += 10;
        cv = Math.min(100, cv);
        var score = Math.round(overseas * 0.25 + china * 0.2 + cv * 0.25 + clamp(margin, 0, 100) * 0.3);
        var level = score >= 90 ? '推荐采购' : score >= 70 ? '可以考虑' : '谨慎采购';
        var advice = score >= 90 ? '买入' : score >= 70 ? '观察' : '放弃';
        return aiFormat(
          (d.name || '-') + ' — ' + (d.artist || '-'),
          '综合评分' + score + '/100，等级：' + level + '。海外热度' + (overseas >= 75 ? '高' : overseas >= 60 ? '中' : '低') + '，中国热度' + (china >= 75 ? '高' : china >= 60 ? '中' : '低') + '，收藏价值' + cv + '/100，利润率' + margin.toFixed(1) + '%。最终建议：' + advice + '。',
          '综合评分：' + score + '/100（' + level + '）',
          '· 海外需求：want ' + want + ' / have ' + have + '\n· 版本价值：' + cv + '/100\n· 利润空间：' + (profit > 0 ? fmtMoney(profit) + '（' + margin.toFixed(1) + '%）' : '暂无利润数据'),
          '· 在售数量：' + nfs + '张' + (nfs < 10 ? '（稀缺但流动性风险）' : '') + '\n· 中国市场认知度' + (china >= 75 ? '高' : '一般') + '\n· ' + (margin < 20 && buy > 0 ? '利润率偏低' : '利润空间尚可'),
          advice + '。' + (score >= 90 ? '海外热度高+利润空间好，推荐采购。' : score >= 70 ? '有一定潜力但存在风险，建议观察。' : '综合表现不佳，建议放弃。'),
          '· 可在Discogs查询更多版本信息\n· 可保存到库存管理\n· 持续关注市场价格波动'
        );
      }
    },
    inventory: {
      label: 'AI库存分析',
      collect: function () { return VHDB.getAll('inventory'); },
      prompt: function (d) {
        return {
          system: '你是黑胶库存管理专家。分析库存数量、黑胶信息、购买价格，判断：1.哪些黑胶适合出售 2.哪些适合长期收藏 3.哪些库存风险较高。输出库存建议。' + AI_FORMAT_SUFFIX,
          user: '库存数据：\n' + JSON.stringify(d.map(function (r) { return { album: r.album, artist: r.artist, catalog: r.catalog, stockQty: r.stockQty, status: r.status, buyPrice: r.buyPrice, sellPrice: r.sellPrice }; }), null, 2)
        };
      },
      local: function (rows) {
        var total = rows.reduce(function (s, r) { return s + (Number(r.stockQty) || 0); }, 0);
        var onSale = rows.filter(function (r) { return r.status === '在售'; }).length;
        var sold = rows.filter(function (r) { return r.status === '已出售'; }).length;
        var artists = {};
        rows.forEach(function (r) { var a = r.artist || '未知'; artists[a] = (artists[a] || 0) + (Number(r.stockQty) || 0); });
        var top = Object.keys(artists).sort(function (a, b) { return artists[b] - artists[a]; }).slice(0, 5);
        var stale = rows.filter(function (r) { return r.status === '在售' && (Number(r.stockQty) || 0) > 3; });
        return aiFormat(
          '黑胶库存总览（' + rows.length + '个品种，' + total + '张）',
          '总库存' + total + '张，在售' + onSale + '个，已售' + sold + '个。' + (stale.length ? '存在' + stale.length + '项高库存待售风险。' : '无明显滞销。') + '热门歌手：' + top.slice(0, 3).join('、'),
          '库存健康度：' + clamp(100 - stale.length * 10, 30, 100) + '/100',
          '· 品种数' + rows.length + '，库存' + total + '张\n· 热门歌手：\n' + top.map(function(a) { return '  ' + a + '（' + artists[a] + '张）'; }).join('\n'),
          (stale.length ? '· 高库存待售：\n' + stale.slice(0, 3).map(function(r) { return '  ' + (r.name || '-') + '（库存' + r.stockQty + '）'; }).join('\n') : '· 无明显滞销风险') + '\n· ' + (onSale > rows.length * 0.7 ? '在售比例偏高，需加速销售' : '在售比例正常'),
          '· 优先销售：高库存且在售时间长的专辑\n· 长期收藏：限量版/首版/彩胶版本\n· 调整价格：在售超30天未成交的降价5-10%',
          '· 定期盘点库存周转率\n· 关注热门歌手的市场动态\n· 可点击【AI库存价值评估】查看库存总值'
        );
      }
    },
    inventory_value: {
      label: 'AI库存价值评估',
      collect: function () { return VHDB.getAll('inventory'); },
      prompt: function (d) {
        return {
          system: '你是黑胶资产评估专家。计算：1.当前库存总价值 2.预计收益 3.资产结构。输出资金管理建议。' + AI_FORMAT_SUFFIX,
          user: '库存数据：\n' + JSON.stringify(d, null, 2)
        };
      },
      local: function (rows) {
        var total = rows.reduce(function (s, r) { return s + (Number(r.stockQty) || 0); }, 0);
        var buyTotal = rows.reduce(function (s, r) { return s + (Number(r.buyPrice) || 0) * (Number(r.stockQty) || 0); }, 0);
        var sellEst = rows.reduce(function (s, r) { return s + (Number(r.sellPrice) || Number(r.buyPrice) || 0) * (Number(r.stockQty) || 0); }, 0);
        var potentialProfit = sellEst - buyTotal;
        var onSale = rows.filter(function (r) { return r.status === '在售'; });
        var onSaleValue = onSale.reduce(function (s, r) { return s + (Number(r.buyPrice) || 0) * (Number(r.stockQty) || 0); }, 0);
        return aiFormat(
          '库存价值评估（' + rows.length + '个品种，' + total + '张）',
          '库存采购总值' + fmtMoney(buyTotal) + '，预计售价总值' + fmtMoney(sellEst) + '，潜在利润' + fmtMoney(potentialProfit) + '。在售' + onSale.length + '个品种，在售采购值' + fmtMoney(onSaleValue) + '。',
          '资产评分：' + clamp(potentialProfit > 0 ? 75 : 40, 0, 100) + '/100',
          '· 库存总值：' + fmtMoney(sellEst) + '\n· 潜在利润：' + fmtMoney(potentialProfit) + '\n· 利润率：' + (buyTotal > 0 ? (potentialProfit / buyTotal * 100).toFixed(1) : '0') + '%',
          '· 采购成本已投入' + fmtMoney(buyTotal) + '\n· ' + (onSale.length > rows.length * 0.7 ? '在售比例高，资金回笼压力大' : '在售比例正常') + '\n· ' + (potentialProfit < 0 ? '潜在亏损，需调整策略' : '有盈利空间但需实际成交'),
          (potentialProfit > 0 ? '保持当前采购节奏，加速在售商品成交' : '减少低利润采购，优化库存结构') + '\n· 优先出售高价库存回笼资金',
          '· 每月盘点库存价值变化\n· 关注高利润品种的采购机会\n· 控制采购资金不超过总资产的70%'
        );
      }
    },
    hot: {
      label: 'AI热点分析',
      collect: function () {
        return VHDB.get('hot_topics', todayStr()).then(function (rec) {
          return rec || { date: todayStr(), videos: [], accounts: [], audios: [], platformGroups: {} };
        });
      },
      prompt: function (d) {
        return {
          system: '你是社交媒体与黑胶市场分析师。分析各平台热点趋势（抖音、小红书、B站、微博、YouTube、音乐趋势），判断：1.哪些歌手热度上涨 2.哪些音乐可能影响黑胶市场 3.哪些热点值得关注。输出今日黑胶机会（如某动漫OST热度上涨可能带动实体唱片需求）。' + AI_FORMAT_SUFFIX,
          user: '今日热点数据（按平台分组）：\n' + JSON.stringify(d, null, 2)
        };
      },
      local: function (d) {
        var vids = d.videos || [], accs = d.accounts || [], auds = d.audios || [];
        var groups = d.platformGroups || {};
        var groupText = Object.keys(groups).map(function(p) {
          return groups[p].label + '：' + groups[p].items.length + '条';
        }).join(' / ') || '无分组数据';
        var musicVids = vids.filter(function (v) { return /音乐|黑胶|唱片|歌手|band|jazz|rock|pop|mv|演唱会/i.test(v.title + v.reason); });
        return aiFormat(
          '每日热点趋势分析（' + todayStr() + '）',
          '共采集' + vids.length + '条热搜，覆盖' + Object.keys(groups).length + '个平台。' + (musicVids.length ? '发现' + musicVids.length + '条音乐相关热点，存在黑胶市场机会。' : '今日热点与黑胶关联度较低。'),
          '市场机会评分：' + clamp(musicVids.length * 15 + Object.keys(groups).length * 10, 0, 100) + '/100',
          '· 热门视频' + vids.length + '条\n· 热门音频' + auds.length + '条\n· ' + (musicVids.length ? '音乐相关：\n' + musicVids.slice(0, 3).map(function(v) { return '  ' + v.title; }).join('\n') : '音乐相关热点暂无'),
          '· 热点变化快，时效性有限\n· ' + (musicVids.length < 2 ? '音乐类热点不足，市场信号弱' : '需进一步验证热点与黑胶的关联度'),
          musicVids.length ? '关注热点相关艺人唱片，及时采购' : '持续监控各平台音乐类热点，等待机会',
          '· 定期采集热搜数据\n· 关注热门音频可能带动的唱片需求\n· 将热点信息与黑胶全分析结合做决策'
        );
      }
    },
    musicnews: {
      label: 'AI音乐趋势分析',
      collect: function () {
        return VHDB.get('music_news', todayStr()).then(function (rec) {
          return (rec && rec.items) ? rec.items : [];
        });
      },
      prompt: function (d) {
        return {
          system: '你是音乐产业与黑胶投资分析师。分析新专辑/新歌/黑胶发行趋势，输出：1.哪些歌手值得关注 2.哪些专辑值得提前布局 3.哪些可能成为收藏热门。输出关注名单。' + AI_FORMAT_SUFFIX,
          user: '今日音乐资讯（全网·海内外）：\n' + JSON.stringify(d, null, 2)
        };
      },
      local: function (items) {
        var vinyl = items.filter(function (it) { return /黑胶|vinyl/i.test(it.format || ''); });
        var regions = {};
        items.forEach(function (it) { var r = it.region || '其他'; regions[r] = (regions[r] || 0) + 1; });
        var artists = {};
        items.forEach(function (it) { var a = it.artist || '未知'; artists[a] = (artists[a] || 0) + 1; });
        var topArtists = Object.keys(artists).sort(function (a, b) { return artists[b] - artists[a]; }).slice(0, 5);
        var priced = items.filter(function (it) { return it.presalePrice; });
        return aiFormat(
          '音乐趋势分析（全网·海内外，' + items.length + '条新发行）',
          '今日新发行' + items.length + '条，其中黑胶' + vinyl.length + '张。地区分布：' + Object.keys(regions).map(function(r) { return r + '(' + regions[r] + ')'; }).join('、') + '。值得关注的艺人：' + topArtists.slice(0, 3).join('、'),
          '投资价值评分：' + clamp(vinyl.length * 10 + priced.length * 5, 0, 100) + '/100',
          '· 新发行' + items.length + '条（黑胶' + vinyl.length + '张）\n· 热门艺人：\n' + topArtists.map(function(a) { return '  ' + a + '（' + artists[a] + '张）'; }).join('\n') + (priced.length ? '\n· 含预售价格' + priced.length + '条' : ''),
          '· ' + (vinyl.length < 3 ? '黑胶发行偏少，投资机会有限' : '黑胶发行活跃但需筛选') + '\n· 海内外价格差异需验证\n· 部分艺人知名度需确认',
          vinyl.length ? '关注日本/欧美黑胶首发，首版/限量版升值潜力最大：\n' + vinyl.slice(0, 3).map(function(v) { return '  ' + (v.artist || '-') + ' — ' + (v.album || '-'); }).join('\n') : '今日无黑胶发行，持续关注',
          '· 建立关注名单，跟踪艺人发行节奏\n· 对比海内外预售价格差异\n· 将高潜力专辑加入黑胶全分析'
        );
      }
    },
    fx: {
      label: 'AI分析采购影响',
      collect: function () {
        return VHDB.get('exchange_rates', todayStr()).then(function (rec) {
          return rec || { date: todayStr(), rates: {} };
        });
      },
      prompt: function (d) {
        return {
          system: '你是外汇与黑胶采购成本分析师。分析当前汇率变化对日本/香港采购的影响、对利润的影响，输出采购建议。' + AI_FORMAT_SUFFIX,
          user: '今日汇率数据：\n' + JSON.stringify(d, null, 2)
        };
      },
      local: function (d) {
        var r = d.rates || {};
        var jpyLow = r.JPY && r.JPY < 0.05;
        return aiFormat(
          '汇率采购影响分析（' + (d.date || todayStr()) + '）',
          (r.JPY ? '日元¥' + r.JPY.toFixed(4) + '，' : '') + (jpyLow ? '日元低位，适合日本采购。' : '日元中等，按需采购。') + (r.HKD ? '港币¥' + r.HKD.toFixed(4) + '。' : ''),
          '采购时机评分：' + (jpyLow ? 85 : 60) + '/100',
          '· 日元：¥' + (r.JPY ? r.JPY.toFixed(4) : '-') + '/JPY\n· 港币：¥' + (r.HKD ? r.HKD.toFixed(4) : '-') + '/HKD\n· ' + (jpyLow ? '日元处于低位，采购成本优势明显' : '汇率中等，无特别优势'),
          '· 汇率波动直接影响采购成本\n· ' + (jpyLow ? '日元可能继续波动' : '日元无优势，采购成本偏高') + '\n· 需关注汇率趋势择机下单',
          jpyLow ? '建议加大日本黑胶采购，关注Mercari/煤炉低价黑胶' : '按需采购，控制库存，关注汇率走势',
          '· 每日更新汇率数据\n· 大额采购前确认汇率\n· 利用汇率换算工具计算成本'
        );
      }
    },
    expense: {
      label: 'AI消费分析',
      collect: function () { return VHDB.getAll('expenses'); },
      prompt: function (d) {
        return {
          system: '你是财务分析师。分析黑胶生意的资金使用情况：1.黑胶投入金额 2.采购成本 3.运营支出。输出资金使用建议（如近期采购投入过高需要控制低利润商品采购）。' + AI_FORMAT_SUFFIX,
          user: '消费记录：\n' + JSON.stringify(d, null, 2)
        };
      },
      local: function (rows) {
        var total = rows.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
        var month = monthStr();
        var monthTotal = rows.filter(function (r) { return (r.date || '').slice(0, 7) === month; }).reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
        var purchases = rows.filter(function (r) { return /采购|黑胶|唱片|进货/i.test(r.note || ''); });
        var purchaseTotal = purchases.reduce(function (s2, r) { return s2 + (Number(r.amount) || 0); }, 0);
        var purchaseRatio = total > 0 ? purchaseTotal / total * 100 : 0;
        return aiFormat(
          '资金分析（总消费' + fmtMoney(total) + '，' + rows.length + '笔）',
          '总消费' + fmtMoney(total) + '，本月' + fmtMoney(monthTotal) + '。采购占比' + purchaseRatio.toFixed(1) + '%，' + (purchaseRatio > 70 ? '偏高需控制。' : '合理。'),
          '资金健康度：' + clamp(100 - (purchaseRatio > 70 ? 30 : 0), 50, 100) + '/100',
          '· 记录' + rows.length + '笔\n· 本月消费' + fmtMoney(monthTotal) + '\n· 采购投入' + fmtMoney(purchaseTotal) + '（' + purchases.length + '笔）',
          '· 采购占比' + purchaseRatio.toFixed(0) + '%，' + (purchaseRatio > 70 ? '偏高' : '正常') + '\n· ' + (monthTotal > total * 0.3 ? '本月消费集中' : '消费分散') + '\n· 需预留周转资金',
          (purchaseRatio > 70 ? '建议减少低利润采购，控制采购节奏' : '保持当前资金管理节奏') + '\n· 每月预留20%资金作为周转\n· 关注单品利润率',
          '· 每月复盘消费结构\n· 区分采购/运营/个人消费\n· 建立利润率淘汰机制'
        );
      }
    },
    crm: {
      label: 'AI客户分析',
      collect: function () { return VHDB.getAll('crm'); },
      prompt: function (d) {
        return {
          system: '你是客户关系管理专家。分析客户：1.客户喜好 2.消费能力 3.推荐方向。输出客户维护建议（如该客户偏好KPOP限定黑胶，可推荐韩国限定发行）。' + AI_FORMAT_SUFFIX,
          user: 'CRM数据：\n' + JSON.stringify(d.map(function (r) { return { name: r.name, contact: r.contact, purchases: r.purchases, note: r.note }; }), null, 2)
        };
      },
      local: function (rows) {
        var withPurchases = rows.filter(function (r) { return r.purchases && r.purchases.length; });
        var artists = {};
        withPurchases.forEach(function (r) {
          (r.purchases || []).forEach(function (p) { var a = p.artist || '未知'; artists[a] = (artists[a] || 0) + 1; });
        });
        var top = Object.keys(artists).sort(function (a, b) { return artists[b] - artists[a]; }).slice(0, 5);
        var totalPurchases = withPurchases.reduce(function (s, r) { return s + (r.purchases || []).length; }, 0);
        return aiFormat(
          '客户分析（' + rows.length + '位客户，' + withPurchases.length + '位有购买记录）',
          '客户' + rows.length + '位，有购买记录' + withPurchases.length + '位。总购买' + totalPurchases + '次，' + (withPurchases.length ? '人均' + (totalPurchases / withPurchases.length).toFixed(1) + '次。' : '暂无购买数据。') + '热门歌手：' + (top.slice(0, 3).join('、') || '暂无'),
          '客户活跃度：' + clamp(withPurchases.length * 20 + totalPurchases * 5, 0, 100) + '/100',
          '· 客户' + rows.length + '位\n· 有购买记录' + withPurchases.length + '位\n· ' + (top.length ? '热门偏好：\n' + top.map(function(a) { return '  ' + a + '（' + artists[a] + '次）'; }).join('\n') : '暂无偏好数据'),
          '· ' + (rows.length - withPurchases.length) + '位客户无购买记录\n· ' + (withPurchases.length < rows.length * 0.5 ? '客户转化率偏低' : '客户转化率正常') + '\n· 客户偏好数据可能不完整',
          '· 对有购买记录的客户定期推送新品\n· 关注高频购买客户，提供优先选购权\n· 对未购买客户推荐热门入门黑胶',
          '· 完善客户偏好信息\n· 建立客户分级管理\n· 定期回访高频客户'
        );
      }
    }
  };

  // 生成 AI 分析区块 HTML（按钮 + 结果面板 + 历史）
  function aiSectionHTML(mid) {
    var cfg = AI_CONFIGS[mid];
    if (!cfg) return '';
    return '<div class="ai-section">' +
      '<button class="btn btn-ai" data-ai="' + mid + '">🤖 ' + esc(cfg.label) + '</button>' +
      '<div class="ai-result hidden" data-ai-result="' + mid + '"></div>' +
      '<div class="ai-history" data-ai-history="' + mid + '"></div>' +
      '</div>';
  }

  // 绑定 AI 按钮（在模块 node 创建后调用）
  function bindAI(node, mid, getExtra) {
    var cfg = AI_CONFIGS[mid];
    if (!cfg) return;
    var btn = node.querySelector('[data-ai="' + mid + '"]');
    var resultEl = node.querySelector('[data-ai-result="' + mid + '"]');
    var histEl = node.querySelector('[data-ai-history="' + mid + '"]');
    if (!btn) return;
    btn.onclick = function () { runAI(mid, resultEl, histEl, getExtra); };
    loadAIHistory(histEl, mid);
  }

  // 执行 AI 分析
  function runAI(mid, resultEl, histEl, getExtra) {
    var cfg = AI_CONFIGS[mid];
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = '<div class="ai-loading">🤖 AI 分析中…</div>';
    var extraP = getExtra ? Promise.resolve(getExtra()) : Promise.resolve({});
    extraP.then(function (extra) {
      return cfg.collect(extra);
    }).then(function (data) {
      return VHDB.getConfig().then(function (settings) {
        var aiProxy = settings.aiProxyUrl || '';
        if (aiProxy) {
          var p = cfg.prompt(data);
          return VHAPI.fetchAIAnalysis(aiProxy, {
            module: mid,
            systemPrompt: p.system,
            userPrompt: p.user,
            data: data
          }).then(function (resp) {
            return {
              module: mid, label: cfg.label,
              result: resp.result || resp.content || resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content || 'AI 返回为空',
              source: 'AI 分析（' + (resp.model || 'DeepSeek') + '）',
              dataKeys: Object.keys(data).length + ' 项数据',
              createdAt: new Date().toISOString()
            };
          });
        } else {
          return {
            module: mid, label: cfg.label,
            result: cfg.local(data),
            source: '本地分析（未配置 AI 代理，不消耗 Token）',
            dataKeys: Object.keys(data).length + ' 项数据',
            createdAt: new Date().toISOString()
          };
        }
      });
    }).then(function (rec) {
      renderAIResult(resultEl, rec, mid);
      VHDB.add('ai_analyses', rec).then(function () { loadAIHistory(histEl, mid); });
      incAIUsage(mid);
    }).catch(function (err) {
      var hint = (err && err.message && (err.message.indexOf('Failed to fetch') >= 0 || err.message.indexOf('NetworkError') >= 0 || err.message.indexOf('超时') >= 0))
        ? '（多为代理域名在国内手机网络被屏蔽/超时，可在「数据采集中心」点「网络诊断」确认，并把代理换成国内可访问的域名）'
        : '（未配置 AI 代理将使用本地分析，不消耗 Token）';
      resultEl.innerHTML = '<div class="ai-error">❌ 分析失败：' + esc((err && err.message) || '未知错误') + '</div>' +
        '<div class="ai-tip">提示：' + hint + ' 如需真实 AI，请在系统设置填写「AI分析代理地址」。</div>';
    });
  }

  // 渲染 AI 分析结果
  function renderAIResult(el, rec, mid) {
    var time = new Date(rec.createdAt).toLocaleString('zh-CN');
    el.innerHTML =
      '<div class="ai-card">' +
      '<div class="ai-card-head"><b>🤖 ' + esc(rec.label) + '</b>' +
      '<span class="ai-time">' + esc(time) + '</span></div>' +
      '<div class="ai-source">数据来源：' + esc(rec.source) + ' · ' + esc(rec.dataKeys || '') + '</div>' +
      '<div class="ai-content">' + esc(rec.result).replace(/\n/g, '<br>') + '</div>' +
      '<div class="ai-actions">' +
      '<button class="btn btn-sm" data-ai-copy="' + mid + '">📋 复制</button>' +
      '<button class="btn btn-sm" data-ai-redo="' + mid + '">🔄 重新分析</button>' +
      '<span class="ai-saved">✓ 已保存到历史</span>' +
      '</div></div>';
    el.querySelector('[data-ai-copy="' + mid + '"]').onclick = function () {
      navigator.clipboard.writeText(rec.result).then(function () { toast('已复制到剪贴板', 'ok'); }).catch(function () { toast('复制失败', 'err'); });
    };
    el.querySelector('[data-ai-redo="' + mid + '"]').onclick = function () {
      runAI(mid, el, el.parentElement.querySelector('[data-ai-history="' + mid + '"]'));
    };
  }

  // 加载历史记录
  function loadAIHistory(el, mid) {
    if (!el) return;
    VHDB.getAll('ai_analyses').then(function (rows) {
      rows = rows.filter(function (r) { return r.module === mid; }).sort(function (a, b) {
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      }).slice(0, 5);
      if (!rows.length) { el.innerHTML = ''; return; }
      el.innerHTML = '<div class="section-title">AI 分析历史（最近 ' + rows.length + ' 条）</div>' +
        rows.map(function (r, i) {
          var time = new Date(r.createdAt).toLocaleString('zh-CN');
          return '<div class="ai-hist-item">' +
            '<span class="ai-hist-time">' + esc(time) + '</span> ' + esc(r.source) +
            ' <button class="btn btn-sm" data-ai-view="' + mid + '" data-idx="' + i + '">查看</button>' +
            '</div>';
        }).join('');
      $$('[data-ai-view="' + mid + '"]', el).forEach(function (btn) {
        btn.onclick = function () {
          var idx = Number(btn.dataset.idx);
          var resultEl = el.parentElement.querySelector('[data-ai-result="' + mid + '"]');
          renderAIResult(resultEl, rows[idx], mid);
        };
      });
    });
  }

  // AI 使用计数（按模块累计）
  function incAIUsage(mid) {
    return VHDB.get('ai_usage', mid).then(function (rec) {
      var next = rec ? (rec.count || 0) + 1 : 1;
      return VHDB.put('ai_usage', { mid: mid, count: next, lastUsed: new Date().toISOString() }).then(function () {
        return next;
      });
    });
  }
  function getAIUsage(mid) {
    return VHDB.get('ai_usage', mid).then(function (rec) { return (rec && rec.count) || 0; });
  }
  function getAllAIUsage() {
    return VHDB.getAll('ai_usage').then(function (rows) {
      var map = {};
      rows.forEach(function (r) { map[r.mid] = r.count || 0; });
      return map;
    });
  }
  /* ---------------- 通用清空按钮 ----------------
   * 给任意模块的 mod-actions 区追加一个「清空」按钮，用于清除该模块已采集/已录入的数据，
   * 避免数据堆积。clearFn 执行实际清空逻辑。
   */
  function addClearButton(node, label, clearFn) {
    var actions = node.querySelector('.mod-actions') || node.querySelector('.mod-head');
    if (!actions) return;
    var btn = elFrom('<button class="btn btn-danger">' + (label || '🗑 清空') + '</button>');
    btn.onclick = function () {
      if (!confirm('确认清空该模块的数据？此操作不可撤销。')) return;
      Promise.resolve(clearFn()).then(function () {
        toast('已清空', 'ok');
        if (node._refresh) node._refresh();
      }).catch(function (e) { toast('清空失败：' + e.message, 'err'); });
    };
    actions.appendChild(btn);
  }

  /* ---------------- 自定义模块 ---------------- */

  // 首页驾驶舱（新指标）
  function buildDashboard() {
    var waveBars = [10, 18, 26, 14, 22, 30, 16, 24, 12, 28, 20, 14, 26, 18, 22, 12]
      .map(function (h) { return '<i style="height:' + h + 'px"></i>'; }).join('');
    var QUICK = [
      { id: 'websites', icon: '🔗', label: '唱片网址' },
      { id: 'discogs', icon: '💿', label: 'Discogs 资料' },
      { id: 'auth', icon: '🔍', label: '真假鉴定' },
      { id: 'analysis', icon: '📊', label: '黑胶全分析' },
      { id: 'profit', icon: '🧮', label: '利润计算' },
      { id: 'inventory', icon: '📦', label: '库存管理' },
      { id: 'plan', icon: '✅', label: '每日计划' }
    ];
    var node = elFrom('<div class="module">' +
      '<div class="vh-hero"><div class="vinyl vinyl-lg"></div>' +
      '<div><h2>首页驾驶舱</h2><div class="sub-title">长期主义 · 黑胶信息差商业工作台</div></div>' +
      '<div class="wave">' + waveBars + '</div></div>' +
      '<div class="dash-grid" id="dashGrid"></div>' +
      '<div class="dash-row">' +
      '  <div class="card"><h3>最近鉴定记录</h3><div id="dashAuth"></div></div>' +
      '  <div class="card"><h3>最近全分析</h3><div id="dashFull"></div></div>' +
      '  <div class="card"><h3>最新音乐资讯</h3><div id="dashMusic"></div></div>' +
      '</div>' +
      '<div class="section-title">快捷入口</div>' +
      '<div class="quick-grid" id="quickGrid"></div></div>');

    $('#quickGrid', node).innerHTML = QUICK.map(function (q) {
      return '<button class="quick-btn" data-go="' + q.id + '"><span class="qi">' + q.icon + '</span>' + esc(q.label) + '</button>';
    }).join('');
    $$('[data-go]', node).forEach(function (b) { b.onclick = function () { showView(b.dataset.go); }; });

    node._refresh = function () {
      Promise.all([
        VHDB.get('daily_plans', todayStr()),
        VHDB.getAll('inventory'),
        VHDB.getAll('expenses'),
        VHDB.getAll('auth_records'),
        VHDB.getAll('full_analysis'),
        VHDB.get('music_news', todayStr())
      ]).then(function (r) {
        var plans = r[0], inv = r[1], exps = r[2], auth = r[3], full = r[4], music = r[5];
        var planTotal = plans && plans.tasks ? plans.tasks.length : 0;
        var planDone = plans && plans.tasks ? plans.tasks.filter(function (t) { return t.done; }).length : 0;
        var rate = planTotal ? Math.round(planDone / planTotal * 100) : 0;
        var todayExp = exps.filter(function (e) { return e.date === todayStr(); }).reduce(function (s, e) { return s + (Number(e.amount) || 0); }, 0);
        var monthExp = exps.filter(function (e) { return monthStr(e.date) === monthStr(); }).reduce(function (s, e) { return s + (Number(e.amount) || 0); }, 0);
        var stockTotal = inv.reduce(function (s, i) { return s + (Number(i.stockQty) || 0); }, 0);

        var cards = [
          { k: '今日任务完成率', v: rate + '<small>%</small>', cls: 'accent' },
          { k: '库存数量', v: stockTotal + '<small> 张</small>' },
          { k: '今日消费', v: fmtMoney(todayExp) },
          { k: '本月消费', v: fmtMoney(monthExp), cls: 'good' }
        ];
        $('#dashGrid', node).innerHTML = cards.map(function (c) {
          return '<div class="stat-card ' + (c.cls || '') + '"><div class="k">' + c.k + '</div><div class="v">' + c.v + '</div></div>';
        }).join('');

        var lastAuth = auth.slice().sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); })[0];
        $('#dashAuth', node).innerHTML = lastAuth
          ? '<div class="item" style="padding:10px 0"><div class="body"><b>' + esc(lastAuth.album || lastAuth.catalog || '鉴定记录') + '</b> ' +
            '<span class="tag ' + (lastAuth.score >= 90 ? 'good' : lastAuth.score >= 70 ? 'warn' : 'bad') + '">参考 ' + lastAuth.score + ' · ' + esc(lastAuth.advice || '') + '</span>' +
            '<div class="meta">' + esc([lastAuth.catalog, lastAuth.country, lastAuth.year].filter(Boolean).join(' · ')) + '</div></div></div>'
          : '<div class="empty" style="padding:10px 0">暂无鉴定记录</div>';

        var lastFull = full.slice().sort(function (a, b) { return (b.analyzedAt || b.createdAt || '').localeCompare(a.analyzedAt || a.createdAt || ''); })[0];
        $('#dashFull', node).innerHTML = lastFull
          ? '<div class="item" style="padding:10px 0"><div class="body"><b>' + esc(lastFull.name || '分析记录') + '</b> ' +
            '<span class="tag ' + (lastFull.score >= 75 ? 'good' : lastFull.score >= 60 ? 'warn' : 'bad') + '">评分 ' + lastFull.score + ' · ' + esc(lastFull.advice || '') + '</span>' +
            '<div class="meta">海外热度 ' + (lastFull.overseasLevel || lastFull.overseasHot || '-') + ' · 中国热度 ' + (lastFull.chinaLevel || lastFull.chinaHot || '-') + '</div></div></div>'
          : '<div class="empty" style="padding:10px 0">暂无分析记录</div>';

        var items = music && music.items ? music.items : [];
        var lastMusic = items[0];
        $('#dashMusic', node).innerHTML = lastMusic
          ? '<div class="item" style="padding:10px 0"><div class="body"><b>' + esc(lastMusic.artist || '') + '</b> — ' + esc(lastMusic.album || '') +
            ' <span class="tag">' + esc(lastMusic.region || '') + '</span> <span class="tag">' + esc(lastMusic.format || '') + '</span>' +
            '<div class="meta">发布：' + esc(lastMusic.releaseDate || '') + ' · ' + esc(lastMusic.company || '') + '</div></div></div>'
          : '<div class="empty" style="padding:10px 0">暂无音乐资讯</div>';
      });
    };
    return { node: node, refresh: node._refresh };
  }

  // 数据采集中心
  function buildDataHub() {
    var actions = [
      { label: '更新今日汇率', fn: collectFx },
      { label: '查询 Discogs 黑胶资料', fn: function () { showView('discogs'); } },
      { label: '采集全球音乐资讯', fn: collectMusicNews },
      { label: '采集 4 平台实时热搜', fn: collectHot },
      { label: '采集抖音热门视频', fn: collectVideo },
      { label: '采集抖音热门音乐', fn: collectAudio }
    ];
    var node = elFrom('<div class="module"><h2>数据采集中心</h2>' +
      '<div class="hint">所有数据均需你主动点击按钮才会采集，<b>不会自动联网</b>，以节省 Token / API 额度。未配置数据源时，请在各模块使用「新增」手动录入。</div>' +
      '<div class="dash-grid" id="hubGrid"></div>' +
      '<div class="section-title" style="margin-top:18px">📡 手机无法获取 / AI 失败？先跑网络诊断</div>' +
      '<div class="diag-box" id="hubDiag">' +
      '  <div class="hint">数据获取与 AI 都走同一个代理（Cloudflare Worker）。如果你在手机上打不开，多半是该域名在你的网络/地区被屏蔽或超时。点下面按钮，会用<b>你当前手机</b>直接测试代理连通性。</div>' +
      '  <button class="btn btn-primary" id="diagBtn" style="margin-top:10px">📡 开始网络诊断（用本机测）</button>' +
      '  <div id="diagResult" class="diag-result"></div>' +
      '</div></div>');
    node._refresh = function () {};
    var grid = $('#hubGrid', node);
    actions.forEach(function (a) {
      var card = elFrom('<div class="stat-card"><div class="k">' + esc(a.label) + '</div>' +
        '<button class="btn btn-collect" style="margin-top:12px;width:100%">🔄 开始采集</button></div>');
      card.querySelector('button').onclick = function () {
        var b = card.querySelector('button'); b.disabled = true; var old = b.textContent; b.textContent = '采集中…';
        a.fn()
          .then(function () { /* toast 由采集函数负责 */ })
          .catch(function (e) { toast('采集失败：' + networkErrHint(e), 'err'); })
          .then(function () { b.disabled = false; b.textContent = old; });
      };
      grid.appendChild(card);
    });
    // 网络诊断
    node.querySelector('#diagBtn').onclick = function () {
      var btn = node.querySelector('#diagBtn');
      var out = node.querySelector('#diagResult');
      btn.disabled = true; btn.textContent = '诊断中…（最多 8 秒每项）';
      out.innerHTML = '<div class="ai-loading">正在用本机测试代理连通性…</div>';
      VHDB.getConfig().then(function (cfg) {
        var proxy = cfg.chinaHotProxy || 'https://vinyl-proxy.w79m2n5jms.workers.dev';
        return VHAPI.networkDiagnostics(proxy);
      }).then(function (d) {
        var rows = (d.endpoints || []).map(function (e) {
          var ok = e.ok;
          var cls = ok ? 'good' : 'bad';
          var detail = ok
            ? (e.status + ' · ' + e.latencyMs + 'ms · ' + (e.size || 0) + 'B')
            : (e.error || ('HTTP ' + e.status));
          return '<div class="diag-row ' + cls + '"><span>' + esc(e.name) + '</span><span>' + esc(detail) + '</span></div>';
        }).join('');
        var verdict;
        if (d.blocked) {
          verdict = '<div class="diag-verdict bad">⚠️ 你的网络/地区<b>无法访问该代理</b>（' + d.reachable + '/' + (d.endpoints || []).length + ' 个接口可达）。' +
            '这是「数据获取 + AI」同时在手机上失败的最常见原因——代理域名 *.workers.dev 在国内手机网络常被屏蔽或超时。' +
            '<br>解决办法：① 换能正常访问该域名的网络（如部分家庭宽带/科学上网）；② 在「系统设置」把两个代理地址改成<b>你自己的、国内可访问的域名</b>（绑定自定义域名或用国内可访问的代理）；③ 未配代理时 AI 会走本地确定性算法（不消耗 Token，但非大模型）。</div>';
        } else if (!d.allUp) {
          verdict = '<div class="diag-verdict warn">部分接口异常（' + d.reachable + '/' + (d.endpoints || []).length + ' 可达），可重试；若长期如此需检查代理部署。</div>';
        } else {
          verdict = '<div class="diag-verdict good">✅ 代理完全可达（' + d.reachable + '/' + (d.endpoints || []).length + '），如仍失败请检查浏览器缓存或重试。</div>';
        }
        out.innerHTML = '<div class="diag-head">代理：' + esc(d.proxy) + '</div>' + rows + verdict;
      }).catch(function (e) {
        out.innerHTML = '<div class="diag-verdict bad">诊断出错：' + esc(e.message) + '</div>';
      }).then(function () { btn.disabled = false; btn.textContent = '📡 重新诊断'; });
    };
    return { node: node, refresh: node._refresh };
  }

  // 把网络类错误翻译成更易懂的提示
  function networkErrHint(e) {
    var m = (e && e.message) || '';
    if (m.indexOf('Failed to fetch') >= 0 || m.indexOf('NetworkError') >= 0) return '网络被拦截/无法连接代理（多为地域屏蔽 *.workers.dev，见数据采集中心「网络诊断」）';
    if (m.indexOf('timeout') >= 0 || m.indexOf('超时') >= 0) return '请求超时（代理不可达或网络慢，见数据采集中心「网络诊断」）';
    if (m.indexOf('HTTP') >= 0) return m;
    return m || '未知错误';
  }

  // 黑胶真假鉴定助手（人工核对 + 图片上传，不做自动识别）
  function buildAuth() {
    var CHECKS = [
      { k: 'catalogOk', l: 'Catalog / Matrix 编号与官方一致', weight: 22 },
      { k: 'labelOk', l: '厂牌 / 版本 / 发行信息一致', weight: 18 },
      { k: 'priceOk', l: '价格正常（无明显异常偏低）', weight: 16 },
      { k: 'printOk', l: '封面 / 标签印刷清晰、无错版', weight: 16 },
      { k: 'sellerOk', l: '卖家信誉良好', weight: 14 },
      { k: 'imgOk', l: '已上传封面 / 外包装 / 标签照片供核对', weight: 14 }
    ];
    var node = elFrom('<div class="module"><div class="mod-head"><h2>黑胶真假鉴定助手</h2>' +
      '<div class="mod-actions"><button class="btn btn-primary" id="addBtn">＋ 新建鉴定</button></div></div>' +
      '<div class="hint">本助手「不自动识别图片、不自动扫描图片」。请人工核对后勾选检查项并上传照片，系统生成<b>真实性参考评分（100分制）</b>与风险等级。</div>' +
      '<div class="form-wrap hidden" id="formWrap"></div>' +
      '<div class="list-wrap" id="listWrap"><div class="empty">加载中…</div></div>' +
      aiSectionHTML('auth') + aiSectionHTML('auth_checklist') + '</div>');
    var listWrap = node.querySelector('#listWrap');
    var formWrap = node.querySelector('#formWrap');
    var editingId = null;

    function buildForm(item) {
      item = item || {};
      var html = '<form id="authForm"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
      [['album', '专辑名称'], ['catalog', 'Catalog Number'], ['matrix', 'Matrix 编号'], ['year', '发行年份'], ['country', '发行国家']].forEach(function (p) {
        html += '<label>' + p[1] + '<input type="text" name="' + p[0] + '" value="' + esc(item[p[0]]) + '"></label>';
      });
      html += '</div><div class="section-title">上传照片（供人工核对，不自动识别）</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">';
      [['coverImg', '封面图片'], ['sleeveImg', '外包装图片'], ['labelImg', '标签图片']].forEach(function (p) {
        html += '<label>' + p[1] + '<input type="file" name="' + p[0] + '" accept="image/*"></label>';
      });
      html += '</div><div class="section-title">人工核对项（勾选通过）</div><div id="checks">';
      CHECKS.forEach(function (c) {
        var on = item.checks && item.checks.indexOf(c.k) >= 0 ? 'checked' : '';
        html += '<label style="display:flex;gap:8px;align-items:center;margin:6px 0;font-size:13px;color:var(--text)"><input type="checkbox" name="' + c.k + '" value="1" ' + on + '> ' + esc(c.l) + '（' + c.weight + '分）</label>';
      });
      html += '</div><div class="form-btns"><button type="submit" class="btn btn-primary">生成参考评分</button><button type="button" class="btn" id="cancelBtn">取消</button></div></form>';
      formWrap.innerHTML = html; formWrap.classList.remove('hidden');
      formWrap.querySelector('#cancelBtn').onclick = function () { formWrap.classList.add('hidden'); editingId = null; };
      formWrap.querySelector('#authForm').onsubmit = function (e) {
        e.preventDefault();
        var f = e.target;
        var data = {
          album: f.album.value, catalog: f.catalog.value, matrix: f.matrix.value,
          year: f.year.value, country: f.country.value
        };
        Promise.all([
          readFileAsDataURL(f.coverImg.files[0]),
          readFileAsDataURL(f.sleeveImg.files[0]),
          readFileAsDataURL(f.labelImg.files[0])
        ]).then(function (imgs) {
          data.coverImg = imgs[0]; data.sleeveImg = imgs[1]; data.labelImg = imgs[2];
          var checks = CHECKS.filter(function (c) { return f[c.k] && f[c.k].checked; }).map(function (c) { return c.k; });
          var score = CHECKS.reduce(function (s, c) { return s + (checks.indexOf(c.k) >= 0 ? c.weight : 0); }, 0);
          var advice = score >= 90 ? '可信度较高' : score >= 70 ? '建议进一步确认' : '风险较高';
          // 编号 / 版本 / 包装 匹配情况（人工核对结果）
          var idMatch = checks.indexOf('catalogOk') >= 0 ? '编号与官方一致' : (data.catalog || data.matrix ? '编号未确认' : '未提供编号');
          var verMatch = checks.indexOf('labelOk') >= 0 ? '版本信息一致' : '版本信息未确认';
          var pkg = checks.indexOf('imgOk') >= 0 ? '已提供封套/标签照片可核对' : '缺少包装照片核对';
          var critical = ['catalogOk', 'labelOk', 'priceOk', 'printOk', 'imgOk'];
          var missing = critical.filter(function (k) { return checks.indexOf(k) < 0; })
            .map(function (k) { return (CHECKS.find(function (c) { return c.k === k; }) || {}).l || k; });
          var anomaly = missing.length ? '异常提示：' + missing.join('；') : '异常提示：未发现明显异常';
          data.checks = checks; data.score = score; data.advice = advice;
          data.idMatch = idMatch; data.verMatch = verMatch; data.pkg = pkg; data.anomaly = anomaly;
          data.createdAt = item.createdAt || new Date().toISOString();
          if (editingId != null) data.id = editingId;
          var p = data.id ? VHDB.put('auth_records', data) : VHDB.add('auth_records', data);
          p.then(function () { toast('鉴定已保存', 'ok'); formWrap.classList.add('hidden'); editingId = null; refresh(); })
            .catch(function (er) { toast('保存失败：' + er.message, 'err'); });
        });
      };
    }

    function thumb(url) { return url ? '<img src="' + esc(url) + '" alt="图">' : ''; }

    function refresh() {
      VHDB.getAll('auth_records').then(function (rows) {
        if (!rows.length) { listWrap.innerHTML = '<div class="empty">暂无鉴定记录。点击「新建鉴定」开始。</div>'; return; }
        listWrap.innerHTML = '<div class="list">' + rows.map(function (r) {
          var cls = r.score >= 90 ? 'good' : r.score >= 70 ? 'warn' : 'bad';
          return '<div class="item"><div class="body">' +
            '<div class="row"><b>' + esc(r.album || r.catalog || '鉴定记录') + '</b>' +
            '<span class="tag ' + cls + '">真实性参考 ' + r.score + ' / 100 · ' + esc(r.advice) + '</span></div>' +
            '<div class="meta">' + esc([r.catalog, r.matrix, r.country, r.year].filter(Boolean).join(' · ')) + '</div>' +
            '<div class="meta">编号匹配：' + esc(r.idMatch || '—') + '</div>' +
            '<div class="meta">版本匹配：' + esc(r.verMatch || '—') + '</div>' +
            '<div class="meta">包装情况：' + esc(r.pkg || '—') + '</div>' +
            '<div class="meta">' + esc(r.anomaly || '') + '</div>' +
            '<div class="meta">核对通过 ' + (r.checks ? r.checks.length : 0) + ' / ' + CHECKS.length + ' 项</div>' +
            '<div class="thumbs">' + thumb(r.coverImg) + thumb(r.sleeveImg) + thumb(r.labelImg) + '</div></div>' +
            '<div class="row-actions"><button class="btn btn-sm" data-edit="' + r.id + '">编辑</button>' +
            '<button class="btn btn-sm btn-danger" data-del="' + r.id + '">删除</button></div></div>';
        }).join('') + '</div>';
        $$('[data-edit]', listWrap).forEach(function (b) {
          b.onclick = function () { var it = rows.find(function (x) { return x.id == b.dataset.edit; }); editingId = it.id; buildForm(it); window.scrollTo({ top: 0, behavior: 'smooth' }); };
        });
        $$('[data-del]', listWrap).forEach(function (b) {
          b.onclick = function () { if (confirm('确认删除该鉴定？')) VHDB.del('auth_records', Number(b.dataset.del)).then(function () { toast('已删除'); refresh(); }); };
        });
      });
    }
    node.querySelector('#addBtn').onclick = function () { editingId = null; buildForm({}); };
    node._refresh = refresh;
    addClearButton(node, '🗑 清空', function () { return VHDB.clear('auth_records'); });
    bindAI(node, 'auth');
    bindAI(node, 'auth_checklist', function() {
      var selected = null;
      // 获取最近一条鉴定记录作为上下文
      return VHDB.getAll('auth_records').then(function(rows) {
        if (rows.length) {
          return rows.sort(function(a,b) { return (b.createdAt||'').localeCompare(a.createdAt||''); })[0];
        }
        return {};
      });
    });
    return { node: node, refresh: refresh };
  }

  // 每日计划
  function buildPlan() {
    var DEFAULTS = ['8:30 早起', '爬楼梯30分钟', '晚上12点前睡觉', '收集风景素材'];
    var node = elFrom('<div class="module"><h2>每日计划</h2>' +
      '<div class="datepick"><label>日期 <input type="date" id="planDate"></label>' +
      '<select id="histSel"></select></div>' +
      '<div id="planStat" class="sub-title"></div>' +
      '<div class="bar"><span id="planBar" style="width:0%"></span></div>' +
      '<div style="margin:14px 0"><input type="text" id="newTask" placeholder="新增任务内容" style="padding:9px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg-2);color:var(--text);width:260px"> ' +
      '<button class="btn btn-primary" id="addTask">＋ 添加</button></div>' +
      '<div class="list" id="planList"></div>' + aiSectionHTML('plan') + '</div>');
    var dateInput = node.querySelector('#planDate');
    var histSel = node.querySelector('#histSel');
    var listEl = node.querySelector('#planList');
    dateInput.value = todayStr();

    function refresh() {
      var d = dateInput.value || todayStr();
      VHDB.getAll('daily_plans').then(function (all) {
        var dates = all.map(function (x) { return x.date; }).sort().reverse();
        histSel.innerHTML = '<option value="">—— 历史日期 ——</option>' + dates.map(function (x) { return '<option value="' + x + '"' + (x === d ? ' selected' : '') + '>' + x + '</option>'; }).join('');
        return VHDB.get('daily_plans', d);
      }).then(function (rec) {
        var tasks = rec && rec.tasks ? rec.tasks : [];
        if (!tasks.length && d === todayStr()) {
          tasks = DEFAULTS.map(function (t) { return { text: t, done: false }; });
        }
        var done = tasks.filter(function (t) { return t.done; }).length;
        var rate = tasks.length ? Math.round(done / tasks.length * 100) : 0;
        node.querySelector('#planStat').textContent = '任务 ' + tasks.length + ' · 完成 ' + done + ' · 完成率 ' + rate + '%';
        node.querySelector('#planBar').style.width = rate + '%';
        listEl.innerHTML = tasks.length ? tasks.map(function (t, i) {
          return '<div class="item"><label style="display:flex;gap:10px;align-items:center;flex:1;cursor:pointer">' +
            '<input type="checkbox" data-i="' + i + '"' + (t.done ? ' checked' : '') + '> <span style="' + (t.done ? 'text-decoration:line-through;color:var(--muted)' : '') + '">' + esc(t.text) + '</span></label>' +
            '<button class="btn btn-sm btn-danger" data-del="' + i + '">删除</button></div>';
        }).join('') : '<div class="empty">今日暂无任务，添加或查看历史。</div>';
        $$('input[type=checkbox]', listEl).forEach(function (c) {
          c.onchange = function () {
            tasks[Number(c.dataset.i)].done = c.checked;
            VHDB.put('daily_plans', { date: d, tasks: tasks }).then(refresh);
          };
        });
        $$('[data-del]', listEl).forEach(function (b) {
          b.onclick = function () { tasks.splice(Number(b.dataset.del), 1); VHDB.put('daily_plans', { date: d, tasks: tasks }).then(refresh); };
        });
      });
    }
    dateInput.onchange = refresh;
    histSel.onchange = function () { if (histSel.value) { dateInput.value = histSel.value; refresh(); } };
    node.querySelector('#addTask').onclick = function () {
      var v = node.querySelector('#newTask').value.trim(); if (!v) return;
      var d = dateInput.value || todayStr();
      VHDB.get('daily_plans', d).then(function (rec) {
        var tasks = rec && rec.tasks ? rec.tasks.slice() : [];
        tasks.push({ text: v, done: false });
        return VHDB.put('daily_plans', { date: d, tasks: tasks });
      }).then(function () { node.querySelector('#newTask').value = ''; refresh(); });
    };
    node._refresh = refresh;
    addClearButton(node, '🗑 清今日', function () { return VHDB.del('daily_plans', todayStr()); });
    bindAI(node, 'plan');
    return { node: node, refresh: refresh };
  }

  // 每日热点（4 平台分采：抖音 / 小红书 / 微博 / B站，每个按钮只采集该平台实时热点）
  function buildHot() {
    var PLATFORM_META = {
      douyin:      { label: '抖音',   color: '#161823', icon: '🎬', app: 'snssdk1128://search?keyword=', web: 'https://www.douyin.com/search/' },
      xiaohongshu: { label: '小红书', color: '#ff2442', icon: '📕', app: 'xhsdiscover://search/result?keyword=', web: 'https://www.xiaohongshu.com/search_result?keyword=' },
      weibo:       { label: '微博',   color: '#e6162d', icon: '🔥', app: 'sinaweibo://search/all?q=', web: 'https://s.weibo.com/weibo?q=' },
      bilibili:    { label: 'B站',    color: '#fb7299', icon: '📺', app: 'bilibili://search?keyword=', web: 'https://search.bilibili.com/all?keyword=' }
    };
    var ORDER = ['douyin', 'xiaohongshu', 'weibo', 'bilibili'];
    var node = elFrom('<div class="module"><div class="mod-head"><h2>每日热点</h2>' +
      '<div class="mod-actions">' +
      '<button class="btn btn-collect" data-pbtn="douyin">🎬 抖音热点信息</button>' +
      '<button class="btn btn-collect" data-pbtn="xiaohongshu">📕 小红书热点信息</button>' +
      '<button class="btn btn-collect" data-pbtn="weibo">🔥 微博热点信息</button>' +
      '<button class="btn btn-collect" data-pbtn="bilibili">📺 B站热点信息</button>' +
      '<button class="btn btn-danger" id="clearHot">🗑 清空</button>' +
      '</div></div>' +
      '<div class="hint">四个按钮分别对应 抖音 / 小红书 / 微博 / B站，<b>每个按钮只采集该平台的实时热点信息</b>，互不影响、可单独刷新。每条热点带「打开 App / 网页查看」跳转。数据来自 Cloudflare Worker 代理。</div>' +
      ORDER.map(function (p) {
        var m = PLATFORM_META[p];
        return '<div class="group-block"><div class="group-head" style="border-left:4px solid ' + m.color + '">' + m.icon + ' ' + m.label + ' 实时热点</div>' +
          '<div id="pbox_' + p + '" class="list"><div class="empty">暂无，点击「' + m.label + '热点信息」采集</div></div></div>';
      }).join('') +
      aiSectionHTML('hot') + '</div>');

    // 平台跳转按钮（App scheme，失败回退网页）
    function jumpBtns(platform, keyword) {
      var m = PLATFORM_META[platform] || { label: platform, color: '#888', icon: '🔗', app: '', web: '' };
      var kw = encodeURIComponent(keyword || '');
      var html = '';
      if (m.app) html += ' <a class="mini-btn" href="' + esc(m.app + kw) + '" onclick="setTimeout(function(){window.open(\'' + esc(m.web + kw) + '\',\'_blank\')},600)">📱 打开App</a>';
      html += ' <a class="mini-btn" href="' + esc(m.web + kw) + '" target="_blank" rel="noopener">🌐 网页查看</a>';
      return html;
    }

    function collectPlatform(p) {
      var btn = node.querySelector('[data-pbtn="' + p + '"]');
      var old = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '采集中…'; }
      return VHDB.getConfig().then(function (cfg) {
        if (!cfg.chinaHotProxy) { toast('未配置代理地址（系统设置→中国热搜代理）', 'err'); return; }
        return VHAPI.fetchPlatformHot(cfg.chinaHotProxy, p).then(function (data) {
          return VHDB.get('hot_topics', todayStr()).then(function (rec) {
            rec = rec || { date: todayStr(), platforms: {} };
            if (!rec.platforms) rec.platforms = {};
            rec.platforms[p] = (data.words || []).map(function (w) { return String(w); });
            rec.date = todayStr();
            rec['updated_' + p] = data.updatedAt || Date.now();
            return VHDB.put('hot_topics', rec).then(function () {
              toast(PLATFORM_META[p].label + '已采集 ' + (data.words || []).length + ' 条实时热点', 'ok');
            });
          });
        });
      }).then(function () { if (btn) { btn.disabled = false; btn.textContent = old; } refresh(); })
        .catch(function (e) { if (btn) { btn.disabled = false; btn.textContent = old; } toast('采集失败：' + e.message, 'err'); refresh(); });
    }

    function refresh() {
      VHDB.get('hot_topics', todayStr()).then(function (rec) {
        rec = rec || { platforms: {} };
        var plats = rec.platforms || {};
        ORDER.forEach(function (p) {
          var box = node.querySelector('#pbox_' + p);
          var m = PLATFORM_META[p];
          var words = plats[p] || [];
          if (words.length) {
            box.innerHTML = words.map(function (w, idx) {
              return '<div class="item" style="padding:8px 14px;border-bottom:1px solid var(--line)"><div class="body" style="display:flex;gap:10px;align-items:center">' +
                '<span style="font-size:1.1em;font-weight:700;color:' + m.color + ';min-width:28px">#' + (idx + 1) + '</span>' +
                '<div style="flex:1"><b>' + esc(w) + '</b><div class="meta">' + jumpBtns(p, w) + '</div></div></div></div>';
            }).join('');
          } else {
            box.innerHTML = '<div class="empty">暂无，点击「' + m.label + '热点信息」采集</div>';
          }
        });
      });
    }
    ORDER.forEach(function (p) {
      node.querySelector('[data-pbtn="' + p + '"]').onclick = function () { collectPlatform(p); };
    });
    node.querySelector('#clearHot').onclick = function () {
      if (!confirm('确认清空今日全部平台热点数据？')) return;
      VHDB.put('hot_topics', { date: todayStr(), platforms: {} }).then(function () { toast('已清空', 'ok'); refresh(); });
    };
    node._refresh = refresh;
    bindAI(node, 'hot');
    return { node: node, refresh: refresh };
  }

  // 音乐新信息
  function buildMusicNews() {
    var node = elFrom('<div class="module"><div class="mod-head"><h2>音乐新信息</h2>' +
      '<div class="mod-actions"><button class="btn btn-collect" id="cNews">🎵 采集全网音乐资讯</button></div></div>' +
      '<div class="hint">数据来源：<b>MusicBrainz + iTunes</b>（全网·海内外覆盖，含预售价格）。经 Cloudflare Worker 代理访问。点「采集」即取今日新发行。也可手动添加。</div>' +
      '<details class="form-wrap"><summary style="cursor:pointer;font-weight:600">＋ 手动添加资讯</summary>' +
      '<form id="nForm" style="margin-top:10px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<label>地区<select name="region"><option>日本</option><option>韩国</option><option>美国</option><option>欧洲</option><option>中国港台</option><option>中国内地</option><option>其他</option></select></label>' +
      '<label>歌手<input name="artist"></label><label>专辑<input name="album"></label>' +
      '<label>发布时间<input name="releaseDate"></label><label>格式<select name="format"><option>CD</option><option>黑胶</option><option>数字</option></select></label>' +
      '<label>售价<input name="price"></label><label>预售价格<input name="presalePrice"></label>' +
      '<label>出版公司<input name="company"></label><label>出版国家<input name="country"></label>' +
      '<label>购买链接<input name="buyLink"></label><label>来源<input name="source" placeholder="MusicBrainz / iTunes / 自定义"></label>' +
      '<label class="full">来源链接<input name="srcLink"></label></div>' +
      '<div class="form-btns"><button class="btn btn-primary">添加</button></div></form></details>' +
      '<div id="nList" class="list"></div>' + aiSectionHTML('musicnews') + '</div>');

    function refresh() {
      VHDB.get('music_news', todayStr()).then(function (rec) {
        var items = rec && rec.items ? rec.items : [];
        if (!items.length) { node.querySelector('#nList').innerHTML = '<div class="empty">暂无，点击「采集」或手动添加</div>'; return; }
        // 按地区分组，结构更清晰
        var byRegion = {};
        items.forEach(function (it) {
          var r = it.region || '其他';
          if (!byRegion[r]) byRegion[r] = [];
          byRegion[r].push(it);
        });
        var regionColor = { '日本': '#2b4a3e', '韩国': '#1a5276', '美国': '#922b21', '欧洲': '#6c3483', '中国港台': '#b9770e', '中国内地': '#117a65', '其他': '#7f8c8d' };
        node.querySelector('#nList').innerHTML = Object.keys(byRegion).map(function (r) {
          var color = regionColor[r] || '#7f8c8d';
          return '<div class="group-block"><div class="group-head" style="border-left:4px solid ' + color + '">' + esc(r) + '（' + byRegion[r].length + '）</div><div class="news-grid">' +
            byRegion[r].map(function (it) {
              var thumb = it.cover
                ? '<img src="' + esc(it.cover) + '" class="news-thumb" alt="" onerror="this.style.display=\'none\'">'
                : '<div class="noimg">🎵</div>';
              var price = it.presalePrice || it.price || '—';
              return '<div class="news-card">' +
                '<div class="news-cover">' + thumb + (it.format ? '<span class="news-fmt">' + esc(it.format) + '</span>' : '') + '</div>' +
                '<div class="news-info"><b>' + esc(it.artist) + '</b> — ' + esc(it.album) + '</div>' +
                '<div class="meta">发布：' + esc(it.releaseDate || '—') + '</div>' +
                '<div class="meta">公司：' + esc(it.company || '—') + (it.country ? ' / ' + esc(it.country) : '') + '</div>' +
                '<div class="meta">预售/售价：<b>' + esc(price) + '</b>' + (it.source ? ' <span class="tag">' + esc(it.source) + '</span>' : '') + '</div>' +
                '<div class="news-links">' +
                (it.buyLink ? '<a class="mini-btn" href="' + esc(it.buyLink) + '" target="_blank" rel="noopener">🛒 购买</a>' : '') +
                (it.srcLink ? '<a class="mini-btn" href="' + esc(it.srcLink) + '" target="_blank" rel="noopener">🔗 来源</a>' : '') +
                '</div></div>';
            }).join('') +
            '</div></div>';
        }).join('');
      });
    }
    node.querySelector('#cNews').onclick = function () { collectMusicNews().then(refresh).catch(function (e) { toast('采集失败：' + e.message, 'err'); refresh(); }); };
    addClearButton(node, '🗑 清空', function () { return VHDB.put('music_news', { date: todayStr(), items: [] }); });
    node.querySelector('#nForm').onsubmit = function (e) {
      e.preventDefault(); var f = e.target; var it = {
        region: f.region.value, artist: f.artist.value, album: f.album.value, releaseDate: f.releaseDate.value,
        format: f.format.value, price: f.price.value, presalePrice: f.presalePrice.value,
        company: f.company.value, country: f.country.value, source: f.source.value,
        buyLink: f.buyLink.value, srcLink: f.srcLink.value
      };
      VHDB.get('music_news', todayStr()).then(function (rec) {
        rec = rec || { date: todayStr(), items: [] };
        rec.items = rec.items || []; rec.items.unshift(it);
        return VHDB.put('music_news', rec);
      }).then(function () { f.reset(); toast('已添加', 'ok'); refresh(); });
    };
    node._refresh = refresh;
    bindAI(node, 'musicnews');
    return { node: node, refresh: refresh };
  }

  // 实时汇率（含双向汇率换算）
  function buildFx() {
    var CUR = ['CNY', 'USD', 'HKD', 'TWD', 'JPY', 'KRW', 'GBP', 'EUR'];
    var LABELS = { CNY: '人民币', USD: '美元', HKD: '港币', TWD: '台币', JPY: '日元', KRW: '韩元', GBP: '英镑', EUR: '欧元' };
    var node = elFrom('<div class="module"><div class="mod-head"><h2>实时汇率</h2>' +
      '<div class="mod-actions"><button class="btn btn-collect" id="cFx">💲 更新今日汇率</button></div></div>' +
      '<div class="hint">显示 1 单位外币兑换多少人民币（CNY）。数据永久保存，可查看历史。下方支持任意两种货币双向换算。</div>' +
      '<div class="card"><h3>汇率换算</h3>' +
      '<div class="conv-row">' +
      '<input type="number" id="convAmt" placeholder="金额" step="any">' +
      '<select id="convFrom">' + CUR.map(function (c) { return '<option value="' + c + '"' + (c === 'CNY' ? ' selected' : '') + '>' + (LABELS[c] || c) + ' (' + c + ')</option>'; }).join('') + '</select>' +
      '<span style="font-size:1.4em;color:var(--accent)">⇄</span>' +
      '<select id="convTo">' + CUR.map(function (c) { return '<option value="' + c + '"' + (c === 'USD' ? ' selected' : '') + '>' + (LABELS[c] || c) + ' (' + c + ')</option>'; }).join('') + '</select>' +
      '<button class="btn btn-primary" id="convBtn">换算</button></div>' +
      '<div id="convRes" class="score-big"></div></div>' +
      '<div id="fxToday" class="dash-grid" style="margin-top:14px"></div>' +
      '<div class="section-title">历史汇率</div><div id="fxHist" class="list"></div></div>');

    function refresh() {
      Promise.all([VHDB.get('exchange_rates', todayStr()), VHDB.getAll('exchange_rates')]).then(function (r) {
        var today = r[0], all = r[1];
        if (today && today.rates) {
          node.querySelector('#fxToday').innerHTML = Object.keys(today.rates).map(function (c) {
            return '<div class="stat-card"><div class="k">' + (LABELS[c] || c) + ' (' + c + ')</div><div class="v">' + Number(today.rates[c]).toFixed(4) + '</div><div class="meta">CNY / 1 ' + c + '</div></div>';
          }).join('');
        } else {
          node.querySelector('#fxToday').innerHTML = '<div class="empty">今日汇率未更新，点击「更新今日汇率」。</div>';
        }
        var hist = all.filter(function (x) { return x.date !== todayStr(); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        node.querySelector('#fxHist').innerHTML = hist.length ? hist.map(function (h) {
          return '<div class="item"><div class="body"><b>' + esc(h.date) + '</b><div class="meta">' +
            Object.keys(h.rates).map(function (c) { return c + ' ' + Number(h.rates[c]).toFixed(3); }).join(' · ') + '</div></div></div>';
        }).join('') : '<div class="empty">暂无历史</div>';
      });
    }
    node.querySelector('#cFx').onclick = function () { collectFx().then(refresh).catch(function (e) { toast('更新失败：' + e.message, 'err'); }); };
    node.querySelector('#convBtn').onclick = function () {
      var amt = Number(node.querySelector('#convAmt').value);
      var fromCur = node.querySelector('#convFrom').value;
      var toCur = node.querySelector('#convTo').value;
      if (!amt) { toast('请输入金额', 'err'); return; }
      if (fromCur === toCur) {
        node.querySelector('#convRes').textContent = amt + ' ' + fromCur + ' = ' + amt + ' ' + toCur;
        return;
      }
      VHDB.get('exchange_rates', todayStr()).then(function (rec) {
        if (!rec || !rec.rates) { toast('请先更新今日汇率', 'err'); return; }
        // rates[c] = 1外币 = ?人民币。CNY 的 rate 视为 1。
        var fromRate = fromCur === 'CNY' ? 1 : rec.rates[fromCur];
        var toRate = toCur === 'CNY' ? 1 : rec.rates[toCur];
        if (!fromRate || !toRate) { toast('缺少 ' + (!fromRate ? fromCur : toCur) + ' 汇率数据', 'err'); return; }
        // 换算：先把 from 转成 CNY，再从 CNY 转成 to
        var cny = amt * fromRate;
        var result = cny / toRate;
        var rateText = '1 ' + fromCur + ' = ' + (fromRate / toRate).toFixed(4) + ' ' + toCur;
        node.querySelector('#convRes').textContent = amt + ' ' + fromCur + ' = ' + result.toFixed(2) + ' ' + toCur + '  (' + rateText + ')';
      });
    };
    addClearButton(node, '🗑 清汇率', function () { return VHDB.clear('exchange_rates'); });
    node._refresh = refresh;
    return { node: node, refresh: refresh };
  }

  // 数据备份中心
  function buildBackup() {
    var node = elFrom('<div class="module"><h2>数据备份中心</h2>' +
      '<div class="hint">所有数据保存在本机 IndexedDB。建议定期导出备份；更换设备时导入 JSON 即可恢复。</div>' +
      '<div class="mod-actions" style="margin-bottom:16px">' +
      '<button class="btn btn-primary" id="expJson">⬇ 导出 JSON 备份</button>' +
      '<button class="btn btn-primary" id="expCsv">⬇ 导出 Excel(CSV)</button>' +
      '<label class="btn">⬆ 恢复数据<input type="file" id="impFile" accept="application/json" style="display:none"></label>' +
      '<button class="btn btn-danger" id="clearAll">🗑 清空全部数据</button>' +
      '</div><div id="bkInfo" class="sub-title"></div></div>');

    function info() {
      Promise.all(VHDB.STORES.map(function (s) { return VHDB.getAll(s); })).then(function (all) {
        var total = all.reduce(function (s, a) { return s + a.length; }, 0);
        node.querySelector('#bkInfo').textContent = '当前共 ' + VHDB.STORES.length + ' 个数据表，约 ' + total + ' 条记录。';
      });
    }
    node.querySelector('#expJson').onclick = function () {
      VHDB.exportAll().then(function (data) {
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        downloadBlob(blob, 'vinyl-hunter-os-' + todayStr() + '.json');
        toast('JSON 已导出', 'ok');
      });
    };
    node.querySelector('#expCsv').onclick = function () {
      VHDB.exportAll().then(function (data) {
        var csv = '';
        VHDB.STORES.forEach(function (s) {
          var rows = data.data[s] || [];
          if (!rows.length) return;
          csv += '=== ' + s + ' ===\n';
          var keys = {}; rows.forEach(function (r) { Object.keys(r).forEach(function (k) { keys[k] = 1; }); });
          var kh = Object.keys(keys);
          csv += kh.join(',') + '\n';
          rows.forEach(function (r) {
            csv += kh.map(function (k) { return csvCell(r[k]); }).join(',') + '\n';
          });
          csv += '\n';
        });
        var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        downloadBlob(blob, 'vinyl-hunter-os-' + todayStr() + '.csv');
        toast('Excel(CSV) 已导出', 'ok');
      });
    };
    node.querySelector('#impFile').onchange = function (e) {
      var file = e.target.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var payload = JSON.parse(reader.result);
          VHDB.importAll(payload).then(function () { toast('数据已恢复，请刷新各模块查看', 'ok'); info(); });
        } catch (err) { toast('恢复失败：文件格式错误', 'err'); }
      };
      reader.readAsText(file);
    };
    node.querySelector('#clearAll').onclick = function () {
      if (!confirm('⚠️ 此操作将清空全部本地数据且不可恢复！\n如已导出备份可稍后恢复。确定继续？')) return;
      if (!confirm('再次确认：真的要清空所有数据吗？')) return;
      VHDB.clearAll().then(function () { toast('已清空全部数据', 'ok'); info(); });
    };
    node._refresh = info;
    return { node: node, refresh: info };
  }
  function csvCell(v) {
    if (v == null) return '';
    if (typeof v === 'object') v = JSON.stringify(v);
    v = String(v);
    if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
    return v;
  }
  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 100);
  }

  // 唱片网址收藏管理
  function buildWebsites() {
    var CATS = ['黑胶购买平台', '黑胶资料查询', '音乐资讯', '黑胶学习', '自定义分类'];
    var node = elFrom('<div class="module"><div class="mod-head"><h2>🔗 唱片网址</h2>' +
      '<div class="mod-actions"><button class="btn btn-primary" id="addBtn">＋ 添加网址</button></div></div>' +
      '<div class="hint">收藏常用黑胶网站，支持自定义名称与分类（如把 Mercari 改名为「日本煤炉」）。点击「打开网站」在新标签页访问。所有记录永久保存。</div>' +
      '<div style="margin:12px 0;display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
      '<input type="search" id="wSearch" placeholder="搜索名称或分类" style="padding:9px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg-2);color:var(--text);width:240px">' +
      '<select id="wFilter"><option value="">全部分类</option>' + CATS.map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></div>' +
      '<div class="form-wrap hidden" id="formWrap"></div>' +
      '<div class="list-wrap" id="listWrap"><div class="empty">加载中…</div></div></div>');
    var listWrap = node.querySelector('#listWrap');
    var formWrap = node.querySelector('#formWrap');
    var search = node.querySelector('#wSearch');
    var filter = node.querySelector('#wFilter');
    var editingId = null;

    function buildForm(item) {
      item = item || {};
      var html = '<form id="wForm"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<label>网站名称<input type="text" name="name" value="' + esc(item.name) + '" placeholder="如：日本煤炉"></label>' +
        '<label>网址链接<input type="url" name="url" value="' + esc(item.url) + '" placeholder="https://..."></label>' +
        '<label class="full">分类（可自定义）<input type="text" name="category" list="wCats" value="' + esc(item.category) + '">' +
        '<datalist id="wCats">' + CATS.map(function (c) { return '<option value="' + c + '">'; }).join('') + '</datalist></label>' +
        '<label class="full">备注<textarea name="note">' + esc(item.note) + '</textarea></label>' +
        '</div><div class="form-btns"><button type="submit" class="btn btn-primary">保存</button><button type="button" class="btn" id="cancelBtn">取消</button></div></form>';
      formWrap.innerHTML = html; formWrap.classList.remove('hidden');
      formWrap.querySelector('#cancelBtn').onclick = function () { formWrap.classList.add('hidden'); editingId = null; };
      formWrap.querySelector('#wForm').onsubmit = function (e) {
        e.preventDefault(); var f = e.target;
        var data = { name: f.name.value.trim(), url: f.url.value.trim(), category: f.category.value.trim(), note: f.note.value.trim() };
        if (!data.name) { toast('请填写网站名称', 'err'); return; }
        if (!/^https?:\/\//i.test(data.url)) data.url = data.url ? 'https://' + data.url : '';
        data.createdAt = item.createdAt || new Date().toISOString();
        if (editingId != null) data.id = editingId;
        var p = data.id ? VHDB.put('websites', data) : VHDB.add('websites', data);
        p.then(function () { toast('已保存', 'ok'); formWrap.classList.add('hidden'); editingId = null; refresh(); })
          .catch(function (er) { toast('保存失败：' + er.message, 'err'); });
      };
    }

    function refresh() {
      var q = (search.value || '').toLowerCase();
      var cat = filter.value;
      VHDB.getAll('websites').then(function (rows) {
        rows = rows.filter(function (r) {
          var hit = !q || (r.name || '').toLowerCase().indexOf(q) >= 0 || (r.category || '').toLowerCase().indexOf(q) >= 0;
          var catOk = !cat || r.category === cat;
          return hit && catOk;
        });
        if (!rows.length) { listWrap.innerHTML = '<div class="empty">暂无网址，点击「＋ 添加网址」开始收藏。</div>'; return; }
        listWrap.innerHTML = '<div class="list">' + rows.map(function (r) {
          var open = r.url ? '<a class="btn btn-sm" href="' + esc(r.url) + '" target="_blank" rel="noopener">打开网站 ↗</a>' : '<span class="muted">无链接</span>';
          return '<div class="item"><div class="body"><div class="row"><b>' + esc(r.name) + '</b>' +
            (r.category ? '<span class="tag">' + esc(r.category) + '</span>' : '') + '</div>' +
            (r.url ? '<div class="meta">' + esc(r.url) + '</div>' : '') +
            (r.note ? '<div class="meta">' + esc(r.note) + '</div>' : '') +
            '<div class="meta">添加于 ' + esc((r.createdAt || '').slice(0, 10)) + '</div></div>' +
            '<div class="row-actions">' + open +
            '<button class="btn btn-sm" data-edit="' + r.id + '">编辑</button>' +
            '<button class="btn btn-sm btn-danger" data-del="' + r.id + '">删除</button></div></div>';
        }).join('') + '</div>';
        $$('[data-edit]', listWrap).forEach(function (b) {
          b.onclick = function () { var it = rows.find(function (x) { return x.id == b.dataset.edit; }); editingId = it.id; buildForm(it); window.scrollTo({ top: 0, behavior: 'smooth' }); };
        });
        $$('[data-del]', listWrap).forEach(function (b) {
          b.onclick = function () { if (confirm('确认删除该网址？')) VHDB.del('websites', Number(b.dataset.del)).then(function () { toast('已删除'); refresh(); }); };
        });
      });
    }
    node.querySelector('#addBtn').onclick = function () { editingId = null; buildForm({}); };
    search.oninput = refresh;
    filter.onchange = refresh;
    node._refresh = refresh;
    addClearButton(node, '🗑 清空', function () { return VHDB.clear('websites'); });
    return { node: node, refresh: refresh };
  }

  // 系统设置
  function buildSettings() {
    var THEMES = [
      { v: 'light', t: '米白（默认）' },
      { v: 'dark', t: '墨绿深色' },
      { v: 'ocean', t: '海洋蓝' },
      { v: 'sunset', t: '暖橘粉' },
      { v: 'forest', t: '森野绿' },
      { v: 'mono', t: '极简灰' }
    ];
    var node = elFrom('<div class="module"><h2>系统设置</h2>' +
      '<div class="form-wrap"><form id="cfgForm">' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">显示名称<input name="displayName"></label>' +
      '<label style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">主题（工作台风格）<select name="theme">' + THEMES.map(function (x) { return '<option value="' + x.v + '">' + x.t + '</option>'; }).join('') + '</select></label>' +
      '<div class="bg-block"><div class="section-title">工作台背景图（可选）</div>' +
      '<label style="display:flex;flex-direction:row;align-items:center;gap:8px;margin-bottom:10px">启用自定义背景图<input type="checkbox" name="workbenchBgOn" style="width:auto"></label>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">背景图 URL<input name="workbenchBg" placeholder="https://... 图片地址"></label>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">或上传本地图片<input type="file" name="bgFile" accept="image/*"></label>' +
      '<div id="bgPrev" class="bg-prev"></div></div>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">Discogs Token（用于黑胶资料查询）<input name="discogsToken" placeholder="在 discogs.com/settings/developers 申请"></label>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">Discogs 代理地址（可选，解决浏览器跨域；Cloudflare Worker 等，留空走直连）<input name="discogsProxy" placeholder="https://你的worker.dev"></label>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">中国热搜代理地址（可选，用于黑胶全分析的中国热度。部署 Cloudflare Worker 转发微博/抖音热搜，留空则中国热度使用本地估算）<input name="chinaHotProxy" placeholder="https://你的热搜worker.dev"></label>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">AI分析代理地址（可选，用于全局AI分析。部署 Cloudflare Worker 代理调 DeepSeek 等，Key 存 Worker 端不泄露。留空则所有AI分析走本地确定性算法，不消耗Token）<input name="aiProxyUrl" placeholder="https://你的worker.dev/ai-analyze"></label>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">音乐资讯源（可选，留空则通过 Worker 代理 MusicBrainz。填入则用自定义 JSON 源）<input name="musicNewsSource"></label>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">抖音热点源（可选，留空则通过 Worker 热搜采集。填入则用自定义 URL）<input name="hotTopicSource"></label>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">热门音频源（可选，留空则通过 Worker 热搜采集。填入则用自定义 URL）<input name="audioSource"></label>' +
      '<div class="form-btns"><button type="submit" class="btn btn-primary">保存设置</button></div>' +
      '</form></div>' +
      '<div class="hint">热搜代理和 AI 分析代理已默认填入 Worker 地址，开箱即用。音乐资讯（全网·海内外，含预售价格）/热点/音频采集均通过 Worker 代理获取数据，无需额外配置。汇率接口为免费公共服务，无需配置。Discogs 查询需自行申请 Token。</div></div>');
    VHDB.getConfig().then(function (cfg) {
      var f = node.querySelector('#cfgForm');
      ['displayName', 'theme', 'discogsToken', 'discogsProxy', 'chinaHotProxy', 'aiProxyUrl', 'musicNewsSource', 'hotTopicSource', 'audioSource', 'workbenchBg'].forEach(function (k) {
        if (cfg[k] != null) f[k].value = cfg[k];
      });
      if (cfg.workbenchBgOn) f.workbenchBgOn.checked = true;
      if (cfg.workbenchBg) node.querySelector('#bgPrev').innerHTML = '<img src="' + esc(cfg.workbenchBg) + '" alt="" style="max-width:100%;border-radius:8px">';
      applyTheme(cfg.theme || 'light');
    });
    node.querySelector('#cfgForm').onsubmit = function (e) {
      e.preventDefault(); var f = e.target;
      var file = f.bgFile.files && f.bgFile.files[0];
      function doSave(bg) {
        var cfg = {
          displayName: f.displayName.value, theme: f.theme.value, discogsToken: f.discogsToken.value,
          discogsProxy: f.discogsProxy.value,
          chinaHotProxy: f.chinaHotProxy.value,
          aiProxyUrl: f.aiProxyUrl.value,
          musicNewsSource: f.musicNewsSource.value, hotTopicSource: f.hotTopicSource.value,
          audioSource: f.audioSource.value,
          workbenchBgOn: f.workbenchBgOn.checked,
          workbenchBg: bg || f.workbenchBg.value || ''
        };
        VHDB.setConfig(cfg).then(function () { applyTheme(cfg.theme); applyWorkbenchBg(); toast('设置已保存', 'ok'); });
      }
      if (file) readFileAsDataURL(file).then(function (u) { doSave(u); });
      else doSave(f.workbenchBg.value || '');
    };
    node._refresh = function () {};
    return { node: node, refresh: function () {} };
  }
  function applyTheme(t) { document.documentElement.setAttribute('data-theme', t || 'light'); }
  // 自定义工作台背景图（URL 或本地上传的 DataURL），保存到系统设置
  function applyWorkbenchBg() {
    return VHDB.getConfig().then(function (cfg) {
      if (cfg.workbenchBgOn && cfg.workbenchBg) {
        document.body.style.backgroundImage = 'url("' + cfg.workbenchBg + '")';
        document.body.classList.add('has-custom-bg');
      } else {
        document.body.style.backgroundImage = '';
        document.body.classList.remove('has-custom-bg');
      }
    });
  }

  /* ---------------- Discogs 黑胶数据库（查询中心，联动库存） ---------------- */
  /* ---------------- 黑胶全分析（合并选品评分 + 套利分析） ---------------- */
  function buildAnalysis() {
    var node = elFrom('<div class="module">' +
      '<div class="mod-head"><h2>📊 黑胶全分析</h2>' +
      '<div class="mod-actions"><button class="btn btn-primary" id="newBtn">＋ 新建分析</button></div></div>' +
      '<div class="hint">采购决策核心工具，已合并「选品评分 + 套利分析」。所有分析必须点击【开始分析】才会计算，<b>不自动联网、不消耗 Token</b>。结果永久保存在本地，刷新 / 关闭不丢失。</div>' +
      '<div class="section-title">待分析列表</div>' +
      '<div id="pendingList"><div class="empty">暂无待分析项。在 Discogs 查询后点【进入黑胶全分析】可自动生成。</div></div>' +
      '<div class="section-title">分析表单</div>' +
      '<div class="form-wrap" id="formWrap"><form id="aForm">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      '<label>黑胶名称<input type="text" name="name" placeholder="如 Nevermind"></label>' +
      '<label>歌手名称<input type="text" name="artist" placeholder="如 Nirvana"></label>' +
      '<label>Catalog Number<input type="text" name="catalog" placeholder="如 ABCD-123"></label>' +
      '<label>购入价格（采购成本 元）<input type="number" step="any" name="buyPrice" placeholder="0"></label>' +
      '<label class="full">预售价格（预计售价 元）<input type="number" step="any" name="presalePrice" placeholder="0"></label>' +
      '</div>' +
      '<div id="discogsInfo" class="discogs-info hidden"></div>' +
      '<div class="form-btns"><button type="submit" class="btn btn-primary">🚀 开始分析</button>' +
      '<button type="button" class="btn" id="clearBtn">清空</button></div>' +
      '</form></div>' +
      '<div class="section-title">分析结果</div>' +
      '<div id="result"><div class="empty">填写信息后点击「开始分析」。</div></div>' +
      '<div class="section-title">历史分析记录</div>' +
      '<div id="histList"><div class="empty">暂无记录。</div></div></div>');

    var pendingList = node.querySelector('#pendingList');
    var formWrap = node.querySelector('#formWrap');
    var form = node.querySelector('#aForm');
    var discogsInfo = node.querySelector('#discogsInfo');
    var resultEl = node.querySelector('#result');
    var histList = node.querySelector('#histList');
    var editingId = null;
    var draftDiscogs = null;

    function kv(k, v) { return '<div class="kv"><span class="kk">' + esc(k) + '</span><span class="vv">' + esc(v) + '</span></div>'; }
    function fmtPct(v) { return (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
    function levelBadge(v) {
      var cls = v >= 75 ? 'good' : v >= 60 ? 'warn' : 'bad';
      var t = v >= 75 ? '高' : v >= 60 ? '中' : '低';
      return '<span class="tag ' + cls + '">' + t + ' (' + v + ')</span>';
    }
    function renderDiscogsInfo(r) {
      var rows = [['发行版本', r.version], ['发行年份', r.year], ['发行公司', r.company], ['发行国家', r.country], ['版本信息', r.versionInfo]].filter(function (x) { return x[1]; });
      return '<div class="discogs-info-box"><b>已带入 Discogs 资料</b>' +
        (r.cover ? '<img src="' + esc(r.cover) + '" style="width:48px;height:48px;object-fit:cover;border-radius:6px;float:right">' : '') +
        '<div class="kv-grid">' + rows.map(function (x) { return kv(x[0], x[1]); }).join('') + '</div></div>';
    }
    function renderPending(rows) {
      var pend = rows.filter(function (r) { return r.status === 'pending'; });
      if (!pend.length) { pendingList.innerHTML = '<div class="empty">暂无待分析项。在 Discogs 查询后点【进入黑胶全分析】可自动生成。</div>'; return; }
      pendingList.innerHTML = '<div class="list">' + pend.map(function (r) {
        return '<div class="item"><div class="body" style="display:flex;gap:10px;align-items:center">' +
          (r.cover ? '<img src="' + esc(r.cover) + '" style="width:42px;height:42px;object-fit:cover;border-radius:6px">' : '<div class="noimg">💿</div>') +
          '<div style="flex:1"><b>' + esc(r.name || '未命名') + '</b> — ' + esc(r.artist || '') + ' <span class="tag">' + esc(r.catalog || '') + '</span>' +
          '<div class="meta">' + esc([r.version, r.year, r.country].filter(Boolean).join(' · ')) + '</div>' +
          '<div class="meta">创建：' + (r.createdAt || '').slice(0, 16).replace('T', ' ') + ' · 待分析</div></div>' +
          '<button class="btn btn-sm btn-primary" data-an="' + r.id + '">开始分析</button></div></div>';
      }).join('') + '</div>';
      $$('[data-an]', pendingList).forEach(function (b) { b.onclick = function () { loadPending(Number(b.dataset.an), rows); }; });
    }
    function loadPending(id, rows) {
      var r = rows.find(function (x) { return x.id === id; });
      if (!r) return;
      editingId = id; draftDiscogs = r;
      form.elements['name'].value = r.name || ''; form.elements['artist'].value = r.artist || ''; form.elements['catalog'].value = r.catalog || '';
      form.elements['buyPrice'].value = ''; form.elements['presalePrice'].value = '';
      discogsInfo.innerHTML = renderDiscogsInfo(r); discogsInfo.classList.remove('hidden');
      resultEl.innerHTML = '<div class="empty">已载入 Discogs 资料，请填写购入价格与预售价格，然后点击「开始分析」。</div>';
      formWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function () { try { form.elements['buyPrice'].focus(); } catch (e) {} }, 300);
    }
    function showResult(r) {
      var info = [['黑胶名称', r.name], ['歌手', r.artist], ['Catalog Number', r.catalog], ['发行版本', r.version], ['发行年份', r.year], ['发行公司', r.company], ['发行国家', r.country]];
      var baseHtml = '<div class="card"><h3>一、黑胶基础信息</h3><div class="kv-grid">' +
        info.map(function (x) { return kv(x[0], x[1] || '—'); }).join('') +
        kv('版本价值', r.versionValue + ' / 100') + '</div></div>';
      var overseaHtml = '<div class="card"><h3>二、海外热度分析</h3>' + levelBadge(r.overseasHot) +
        '<div class="meta">数据来源：Discogs 社区（海外收藏关注频率）</div>' +
        '<p class="reason">' + esc(r.overseasText) + '</p></div>';
      // 中国热度：分平台展示（4平台，无闲鱼）
      var platformLabels = { weibo:'微博', douyin:'抖音', bilibili:'B站', xiaohongshu:'小红书' };
      var platformColors = { weibo:'#e6162d', douyin:'#161823', bilibili:'#fb7299', xiaohongshu:'#ff2442' };
      var platformOrder = ['weibo','douyin','bilibili','xiaohongshu'];
      var platformHtml = '';
      if (r.chinaPlatforms && Object.keys(r.chinaPlatforms).length) {
        platformHtml = '<div class="platform-grid">';
        platformOrder.forEach(function (p) {
          var pd = r.chinaPlatforms[p];
          if (!pd) { return; }
          var hasHits = pd.hits && pd.hits.length;
          var color = platformColors[p] || '#888';
          platformHtml += '<div class="platform-item' + (hasHits ? ' platform-hit' : '') + '">' +
            '<div class="platform-name" style="border-left:3px solid ' + color + '">' +
            '<span class="platform-dot" style="background:' + color + '"></span>' +
            esc(platformLabels[p] || p) +
            '<span class="platform-count">搜索' + (pd.total || 0) + '次</span></div>' +
            (hasHits
              ? '<div class="platform-matched">命中：' + pd.hits.map(esc).join('、') + '</div>'
              : '<div class="platform-nomatch">未命中</div>') +
            (pd.sample && pd.sample.length
              ? '<details class="platform-details"><summary>查看热搜词</summary><div class="platform-words">' +
                pd.sample.map(function (w) { return '<span class="hot-word">' + esc(w) + '</span>'; }).join('') +
                '</div></details>'
              : '') +
            '</div>';
        });
        platformHtml += '</div>';
      }
      var chinaHtml = '<div class="card"><h3>三、中国市场热度分析（4平台分采）</h3>' + levelBadge(r.chinaHot) +
        '<div class="meta">数据来源：' + esc(r.chinaSource || '参考估算') + '</div>' +
        platformHtml +
        '<p class="reason">' + esc(r.chinaText) + '</p></div>';
      var scoreHtml = '<div class="card score-card"><h3>四、黑胶价值评分</h3>' +
        '<div class="big-score">' + r.score + '<small>/100</small></div>' +
        '<span class="tag ' + (r.score >= 75 ? 'good' : r.score >= 60 ? 'warn' : 'bad') + '">' + esc(r.level) + '</span>' +
        '<div class="meta">收藏价值 ' + r.collectValue + ' / 100</div></div>';
      var profitHtml = '<div class="card"><h3>五、利润分析</h3><div class="kv-grid">' +
        kv('采购成本', fmtMoney(r.buyPrice != null ? r.buyPrice : 0)) +
        kv('预计售价', fmtMoney(r.presalePrice != null ? r.presalePrice : 0)) +
        kv('预计利润', fmtMoney(r.profit)) + kv('利润率', fmtPct(r.margin)) + '</div></div>';
      var adviceCls = r.advice === '推荐购买' ? 'good' : r.advice === '谨慎购买' ? 'warn' : 'bad';
      var adviceHtml = '<div class="card"><h3>六、最终购买建议</h3>' +
        '<span class="tag ' + adviceCls + ' big-tag">' + esc(r.advice) + '</span>' +
        '<p class="reason">' + esc(r.reason) + '</p></div>';
      // 七、AI 深度分析：在专辑信息内单独展示「AI分析」（普通分析见上方六张卡片）
      var aiCardHtml = '<div class="card ai-album-card"><h3>七、AI 深度分析</h3>' +
        '<p class="reason">由 AI（DeepSeek）针对本张专辑做综合研判，与上方「普通分析」互补。未配置 AI 代理时走本地确定性算法，不消耗 Token。</p>' +
        '<button class="btn btn-ai" id="albumAiBtn">🤖 让 AI 分析这张专辑</button>' +
        '<div class="ai-result hidden" id="albumAiResult"></div></div>';
      resultEl.innerHTML = baseHtml + overseaHtml + chinaHtml + scoreHtml + profitHtml + adviceHtml + aiCardHtml;
      var albumAiBtn = node.querySelector('#albumAiBtn');
      if (albumAiBtn) albumAiBtn.onclick = function () { runAI('analysis', node.querySelector('#albumAiResult'), null, function () { return r; }); };
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function renderHist(rows) {
      var done = rows.filter(function (r) { return r.status === 'done'; })
        .sort(function (a, b) { return (b.analyzedAt || '').localeCompare(a.analyzedAt || ''); });
      if (!done.length) { histList.innerHTML = '<div class="empty">暂无记录。</div>'; return; }
      histList.innerHTML = '<div class="list">' + done.map(function (r) {
        return '<div class="item"><div class="body" style="display:flex;gap:10px;align-items:center">' +
          (r.cover ? '<img src="' + esc(r.cover) + '" style="width:40px;height:40px;object-fit:cover;border-radius:6px">' : '<div class="noimg">💿</div>') +
          '<div style="flex:1"><b>' + esc(r.name || '未命名') + '</b> — ' + esc(r.artist || '') + ' <span class="tag">' + esc(r.catalog || '') + '</span>' +
          '<div class="meta">评分 ' + (r.score || '-') + ' · ' + esc(r.advice || '') + ' · 利润 ' + fmtMoney(r.profit) + ' · ' + (r.analyzedAt || '').slice(0, 10) + '</div></div>' +
          '<button class="btn btn-sm" data-view="' + r.id + '">查看</button>' +
          '<button class="btn btn-sm btn-danger" data-del="' + r.id + '">删除</button></div></div>';
      }).join('') + '</div>';
      $$('[data-view]', histList).forEach(function (b) {
        b.onclick = function () { var rec = done.find(function (x) { return x.id === Number(b.dataset.view); }); if (rec) showResult(rec); };
      });
      $$('[data-del]', histList).forEach(function (b) {
        b.onclick = function () { VHDB.del('full_analysis', Number(b.dataset.del)).then(refresh).catch(function (e) { toast('删除失败：' + e.message, 'err'); }); };
      });
    }
    function refresh() {
      VHDB.getAll('full_analysis').then(function (rows) { renderPending(rows); renderHist(rows); });
    }
    form.onsubmit = function (e) {
      e.preventDefault();
      var base = {
        name: form.elements['name'].value.trim(), artist: form.elements['artist'].value.trim(), catalog: form.elements['catalog'].value.trim(),
        buyPrice: form.elements['buyPrice'].value === '' ? '' : Number(form.elements['buyPrice'].value),
        presalePrice: form.elements['presalePrice'].value === '' ? '' : Number(form.elements['presalePrice'].value)
      };
      if (!base.name && !base.artist && !base.catalog) { toast('请至少填写黑胶名称 / 歌手 / Catalog 之一', 'err'); return; }
      if (base.buyPrice === '' && base.presalePrice === '') { toast('请至少填写购入价格或预售价格', 'err'); return; }
      var rec = Object.assign({}, draftDiscogs || {}, base);
      var btn = e.target.querySelector('button[type="submit"]');
      var old = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '分析中…'; }
      // 仅在配置了「中国热搜代理」时，于用户点击【开始分析】这一刻联网拉取热搜词（按钮触发，不自动）
      VHDB.getConfig().then(function (cfg) {
        if (!cfg.chinaHotProxy) return null;
        return VHAPI.fetchChinaHotWords(cfg.chinaHotProxy).catch(function (err) {
          toast('热搜数据获取失败，使用估算：' + err.message, 'err'); return null;
        });
      }).then(function (hotData) {
        analyzeVinyl(rec, hotData);
        rec.status = 'done';
        rec.analyzedAt = new Date().toISOString();
        if (!rec.createdAt) rec.createdAt = rec.analyzedAt;
        if (editingId != null) rec.id = editingId;
        return (editingId != null) ? VHDB.put('full_analysis', rec) : VHDB.add('full_analysis', rec);
      }).then(function () {
        toast('分析完成并保存', 'ok');
        editingId = null; draftDiscogs = null;
        discogsInfo.classList.add('hidden'); discogsInfo.innerHTML = '';
        showResult(rec); refresh();
      }).catch(function (err) {
        toast('分析失败：' + err.message, 'err');
      }).then(function () {
        if (btn) { btn.disabled = false; btn.textContent = old; }
      });
    };
    node.querySelector('#newBtn').onclick = function () {
      editingId = null; draftDiscogs = null; form.reset();
      discogsInfo.classList.add('hidden'); discogsInfo.innerHTML = '';
      resultEl.innerHTML = '<div class="empty">填写信息后点击「开始分析」。</div>';
      formWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    node.querySelector('#clearBtn').onclick = function () {
      editingId = null; draftDiscogs = null; form.reset();
      discogsInfo.classList.add('hidden'); discogsInfo.innerHTML = '';
    };
    node._refresh = refresh; refresh();
    addClearButton(node, '🗑 清空分析', function () { return VHDB.clear('full_analysis'); });
    return { node: node, refresh: refresh };
  }

  function buildDiscogs() {
    var node = elFrom('<div class="module"><div class="mod-head"><h2>💿 Discogs 黑胶数据库</h2>' +
      '<div class="mod-actions"><button class="btn btn-collect" id="qBtn">🔍 查询专辑信息</button></div></div>' +
      '<div class="hint">查询中心：默认查询结果<b>不自动保存</b>。确认入库时点击【保存到黑胶库存】才会写入库存管理。所有查询均点击按钮触发。</div>' +
      '<div class="form-wrap" id="qForm" style="margin:14px 0">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">' +
      '<label>专辑名称<input type="text" id="qAlbum" placeholder="如 Nevermind"></label>' +
      '<label>歌手<input type="text" id="qArtist" placeholder="如 Nirvana"></label>' +
      '<label>Catalog Number<input type="text" id="qCat" placeholder="如 ABCD-123"></label>' +
      '</div></div>' +
      '<div class="section-title">查询结果（点击「查看详情」在该行下方展开完整资料与图片）</div>' +
      '<div id="dResults"><div class="empty">输入查询条件后点击「查询专辑信息」。</div></div>' +
      aiSectionHTML('discogs') + '</div>');

    var resultsEl = node.querySelector('#dResults');
    var currentResults = [];
    var selected = null;

    function rowKV(k, v) { return '<div class="kv"><span class="kk">' + esc(k) + '</span><span class="vv">' + esc(v == null ? '' : v) + '</span></div>'; }

    node.querySelector('#qBtn').onclick = function () {
      var album = node.querySelector('#qAlbum').value.trim();
      var artist = node.querySelector('#qArtist').value.trim();
      var cat = node.querySelector('#qCat').value.trim();
      var q = cat || [artist, album].filter(Boolean).join(' ');
      if (!q) { toast('请填写专辑名称 / 歌手 / Catalog 至少一项', 'err'); return; }
      var b = node.querySelector('#qBtn'); b.disabled = true; var old = b.textContent; b.textContent = '查询中…';
      VHDB.getConfig().then(function (cfg) {
        if (!cfg.discogsToken) { toast('请先在「系统设置」填写 Discogs Token', 'err'); return; }
        return VHAPI.fetchDiscogs(q, cfg.discogsToken, cfg.discogsProxy).then(function (list) {
          currentResults = list;
          if (!list.length) { resultsEl.innerHTML = '<div class="empty">未找到相关结果。</div>'; return; }
          resultsEl.innerHTML = '<div class="list">' + list.map(function (it, i) {
            var cover = it.cover ? '<img src="' + esc(it.cover) + '" alt="" style="width:54px;height:54px;object-fit:cover;border-radius:6px">' : '<div class="noimg">💿</div>';
            var catHtml = it.catalog
              ? '<span class="cat-no">' + esc(it.catalog) + '</span>'
              : '<span class="cat-no cat-missing">未显示编号</span>';
            var fillBtn = it.catalog ? '' : '<button class="btn btn-sm btn-fill" data-fill="' + i + '">补查编号</button>';
            return '<div class="item" data-row="' + i + '"><div class="body" style="display:flex;gap:12px;align-items:center">' + cover +
              '<div style="flex:1"><b>' + esc(it.artist || '') + (it.album ? ' — ' + esc(it.album) : '') + '</b>' +
              '<div class="meta">' + esc([it.year, it.country].filter(Boolean).join(' · ')) + ' · ' + catHtml + '</div>' +
              '<div class="meta">' + esc(it.version || '') + '</div></div>' +
              '<div class="row-actions"><button class="btn btn-sm" data-detail="' + i + '">查看详情</button>' +
              '<button class="btn btn-sm" data-ana="' + i + '">进入全分析</button>' +
              '<button class="btn btn-sm btn-primary" data-save="' + i + '">保存到库存</button>' + fillBtn + '</div></div></div>';
          }).join('') + '</div>';
          $$('[data-detail]', resultsEl).forEach(function (btn) {
            btn.onclick = function () { showDetail(Number(btn.dataset.detail), cfg); };
          });
          $$('[data-save]', resultsEl).forEach(function (btn) {
            btn.onclick = function () { saveToInventory(list[Number(btn.dataset.save)]); };
          });
          $$('[data-ana]', resultsEl).forEach(function (btn) {
            btn.onclick = function () { sendToAnalysis(list[Number(btn.dataset.ana)]); };
          });
          $$('[data-fill]', resultsEl).forEach(function (btn) {
            btn.onclick = function () {
              var idx = Number(btn.dataset.fill); var it = list[idx];
              if (!it.id) { toast('该结果无编号可补查', 'err'); return; }
              btn.disabled = true; btn.textContent = '补查中…';
              VHAPI.fetchDiscogsRelease(it.id, cfg.discogsToken, cfg.discogsProxy).then(function (d) {
                if (d && d.catalog) {
                  it.catalog = d.catalog; it.label = d.label || it.label;
                  // 更新卡片显示
                  var cardMeta = btn.closest('.item').querySelector('.cat-no');
                  if (cardMeta) { cardMeta.textContent = d.catalog; cardMeta.className = 'cat-no'; }
                  btn.remove();
                  toast('已补查编号：' + d.catalog, 'ok');
                } else {
                  toast('详情中仍未包含编号', 'err'); btn.disabled = false; btn.textContent = '补查编号';
                }
              }).catch(function (e) { toast('补查失败：' + e.message, 'err'); btn.disabled = false; btn.textContent = '补查编号'; });
            };
          });
        });
      }).catch(function (e) { toast('查询失败：' + e.message, 'err'); })
        .then(function () { b.disabled = false; b.textContent = old; });
    };

    // 图片灯箱：点击放大查看，可保存
    function openLightbox(src) {
      var ov = elFrom('<div class="lightbox" id="lightboxOv"><img src="' + esc(src) + '" class="lightbox-img" alt=""><div class="lightbox-bar"><button class="btn btn-sm" id="lbSave">💾 保存图片</button><button class="btn btn-sm" id="lbClose">✕ 关闭</button></div></div>');
      document.body.appendChild(ov);
      ov.onclick = function (e) { if (e.target === ov || e.target.id === 'lbClose') ov.remove(); };
      ov.querySelector('#lbClose').onclick = function () { ov.remove(); };
      ov.querySelector('#lbSave').onclick = function (e) { e.stopPropagation(); downloadImage(src, 'discogs-image.jpg'); };
    }
    // 保存图片：优先尝试 fetch 为 blob 下载，失败则新标签打开
    function downloadImage(url, filename) {
      if (!url) return;
      fetch(url, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error('fetch failed'); return r.blob(); }).then(function (blob) {
        var u = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = u; a.download = filename || 'image.jpg';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
        toast('已开始下载图片', 'ok');
      }).catch(function () {
        window.open(url, '_blank');
        toast('已在新标签打开图片，可右键保存', 'ok');
      });
    }

    function showDetail(idx, cfg) {
      var it = currentResults[idx];
      selected = it;
      // 已展开则收起（二次点击折叠）
      var existing = resultsEl.querySelector('[data-detail-panel="' + idx + '"]');
      if (existing) { existing.remove(); return; }
      // 收起其它已展开面板
      $$('[data-detail-panel]', resultsEl).forEach(function (p) { p.remove(); });
      var row = resultsEl.querySelector('[data-row="' + idx + '"]');
      if (!row) return;
      var panel = elFrom('<div class="discogs-detail-inline" data-detail-panel="' + idx + '"><div class="empty">加载详情中…</div></div>');
      row.parentNode.insertBefore(panel, row.nextSibling);
      var p = it.id
        ? VHAPI.fetchDiscogsRelease(it.id, cfg.discogsToken, cfg.discogsProxy)
        : Promise.resolve(it);
      p.then(function (d) {
        d = d || it;
        var cover = d.cover ? '<img src="' + esc(d.cover) + '" alt="封面" style="max-width:160px;border-radius:8px">' : '';
        // 收集所有可查看/保存的图片（封面 + 图集）
        var allImgs = [];
        if (d.cover) allImgs.push(d.cover);
        (d.images || []).filter(Boolean).slice(0, 8).forEach(function (u) { if (allImgs.indexOf(u) < 0) allImgs.push(u); });
        var imgBlock = '';
        if (allImgs.length) {
          imgBlock = '<div class="section-title">图片（点击查看大图 · 可保存）</div><div class="thumbs">' + allImgs.map(function (u, k) {
            return '<div class="thumb-wrap"><img src="' + esc(u) + '" class="thumb-img" alt=""><div class="thumb-acts">' +
              '<button class="btn btn-sm" data-viewimg="' + k + '">🔍 查看</button>' +
              '<button class="btn btn-sm" data-saveimg="' + k + '">💾 保存</button></div></div>';
          }).join('') + '</div>';
        }
        panel.innerHTML =
          '<div class="card"><div style="display:flex;gap:14px;flex-wrap:wrap">' + cover +
          '<div style="flex:1;min-width:240px">' +
          '<h3>' + esc(d.artist || '') + (d.album ? ' — ' + esc(d.album) : '') + '</h3>' +
          rowKV('发行年份', d.year) + rowKV('发行国家', d.country) + rowKV('音乐类型', d.genre || d.style || '—') +
          '</div></div>' +
          '<div class="kv-grid">' +
          rowKV('发行公司', d.label) + rowKV('Catalog Number', d.catalog) +
          rowKV('版本信息', d.version) + rowKV('限量 / 重量', d.limited || '—') +
          rowKV('Discogs 参考价', d.marketPrice ? (d.marketPrice + ' ' + (d.priceCurrency || '')) : '—') +
          '</div>' +
          imgBlock +
          '<div class="form-btns"><button class="btn" data-ana2>进入黑胶全分析</button>' +
          '<button class="btn btn-primary" data-save2>保存到黑胶库存</button></div></div>';
        $$('[data-viewimg]', panel).forEach(function (b) {
          b.onclick = function () { openLightbox(allImgs[Number(b.dataset.viewimg)] || ''); };
        });
        $$('[data-saveimg]', panel).forEach(function (b) {
          b.onclick = function () { downloadImage(allImgs[Number(b.dataset.saveimg)] || '', 'discogs-image.jpg'); };
        });
        panel.querySelector('[data-ana2]').onclick = function () { sendToAnalysis(d); };
        panel.querySelector('[data-save2]').onclick = function () { saveToInventory(d); };
      }).catch(function (e) { panel.innerHTML = '<div class="empty">详情加载失败：' + esc(e.message) + '</div>'; });
    }

    function sendToAnalysis(it) {
      VHDB.getAll('full_analysis').then(function (rows) {
        var dup = rows.find(function (r) {
          return r.status === 'pending' && (
            (it.catalog && r.catalog === it.catalog) ||
            (it.album && r.name === it.album && it.artist && r.artist === it.artist)
          );
        });
        if (dup) { toast('该专辑已在待分析列表', 'ok'); showView('analysis'); return; }
        var rec = {
          name: it.album || it.name || '',
          artist: it.artist || '',
          catalog: it.catalog || '',
          version: it.version || '',
          year: it.year || '',
          company: it.label || '',
          country: it.country || '',
          versionInfo: it.limited || '',
          cover: it.cover || '',
          want: it.want != null ? it.want : null,
          have: it.have != null ? it.have : null,
          numForSale: it.numForSale != null ? it.numForSale : null,
          marketPrice: it.marketPrice || '',
          status: 'pending',
          createdAt: new Date().toISOString()
        };
        return VHDB.add('full_analysis', rec).then(function () {
          toast('已加入黑胶全分析待分析列表', 'ok'); showView('analysis');
        });
      }).catch(function (e) { toast('操作失败：' + e.message, 'err'); });
    }

    function saveToInventory(it) {
      var data = {
        cover: it.cover || '',
        name: it.album || it.name || '',
        singer: it.artist || '',
        catalog: it.catalog || '',
        version: it.version || '',
        year: it.year || '',
        label: it.label || '',
        country: it.country || '',
        weight: it.weight || '',
        limited: it.limited || '',
        buyDate: todayStr(),
        buyPrice: '',
        stockQty: 1,
        status: '在售',
        createdAt: new Date().toISOString()
      };
      VHDB.add('inventory', data).then(function () {
        toast('已保存到黑胶库存（请补充购买价格 / 数量）', 'ok');
        showView('inventory');
      }).catch(function (e) { toast('保存失败：' + e.message, 'err'); });
    }

    node._refresh = function () {};
    addClearButton(node, '🗑 清查询', function () {
      currentResults = []; selected = null;
      resultsEl.innerHTML = '<div class="empty">已清空查询结果与详情。</div>';
    });
    bindAI(node, 'discogs', function () { return selected || {}; });
    return { node: node, refresh: function () {} };
  }

  /* ---------------- 黑胶库存管理（联动 Discogs + CRM） ---------------- */
  function buildInventory() {
    var STATUS = ['在售', '已出售'];
    var node = elFrom('<div class="module"><div class="mod-head"><h2>📦 黑胶库存管理</h2>' +
      '<div class="mod-actions"><button class="btn btn-primary" id="addBtn">＋ 添加库存</button></div></div>' +
      '<div class="hint">与 Discogs 联动：输入 Catalog Number 后点「Discogs 查询并填充」自动回填资料。客户在 CRM 购买后，库存数量自动扣减。</div>' +
      '<div style="margin:12px 0;display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
      '<input type="search" id="iSearch" placeholder="搜索名称 / 歌手 / Catalog" style="padding:9px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg-2);color:var(--text);width:260px">' +
      '<select id="iFilter"><option value="">全部状态</option>' + STATUS.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></div>' +
      '<div class="form-wrap hidden" id="formWrap"></div>' +
      '<div class="list-wrap" id="listWrap"><div class="empty">加载中…</div></div>' +
      aiSectionHTML('inventory') + aiSectionHTML('inventory_value') + '</div>');
    var listWrap = node.querySelector('#listWrap');
    var formWrap = node.querySelector('#formWrap');
    var search = node.querySelector('#iSearch');
    var filter = node.querySelector('#iFilter');
    var editingId = null;
    var pendingCover = '';

    function buildForm(item) {
      item = item || {};
      pendingCover = item.cover || '';
      var html = '<form id="iForm"><div class="discogs-fill">' +
        '<label>通过 Catalog Number 自动填充<input type="text" id="fillCat" placeholder="输入 Catalog 如 ABCD-123"></label>' +
        '<button type="button" class="btn btn-collect" id="fillBtn">Discogs 查询并填充</button></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">' +
        '<label class="full">封面图片<input type="file" id="coverFile" accept="image/*"></label>' +
        '<div id="coverPrev" class="full">' + (item.cover ? '<img src="' + esc(item.cover) + '" style="max-width:120px;border-radius:8px">' : '') + '</div>' +
        '<label>黑胶名称<input type="text" name="name" value="' + esc(item.name) + '"></label>' +
        '<label>歌手<input type="text" name="singer" value="' + esc(item.singer) + '"></label>' +
        '<label>Catalog Number<input type="text" name="catalog" value="' + esc(item.catalog) + '"></label>' +
        '<label>版本信息<input type="text" name="version" value="' + esc(item.version) + '"></label>' +
        '<label>发行年份<input type="text" name="year" value="' + esc(item.year) + '"></label>' +
        '<label>发行公司<input type="text" name="label" value="' + esc(item.label) + '"></label>' +
        '<label>发行国家<input type="text" name="country" value="' + esc(item.country) + '"></label>' +
        '<label>黑胶重量<input type="text" name="weight" value="' + esc(item.weight) + '" placeholder="如 180g"></label>' +
        '<label>限量信息<input type="text" name="limited" value="' + esc(item.limited) + '"></label>' +
        '<label>购买日期<input type="date" name="buyDate" value="' + esc(item.buyDate || todayStr()) + '"></label>' +
        '<label>购买价格<input type="number" step="any" name="buyPrice" value="' + esc(item.buyPrice) + '"></label>' +
        '<label>库存数量<input type="number" min="0" name="stockQty" value="' + esc(item.stockQty != null ? item.stockQty : 1) + '"></label>' +
        '<label>当前状态<select name="status">' + STATUS.map(function (s) { return '<option value="' + s + '"' + (s === (item.status || '在售') ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
        '</div>' +
        '<div class="form-btns"><button type="submit" class="btn btn-primary">保存</button><button type="button" class="btn" id="cancelBtn">取消</button></div></form>';
      formWrap.innerHTML = html; formWrap.classList.remove('hidden');
      var form = formWrap.querySelector('#iForm');
      form.querySelector('#coverFile').onchange = function (e) {
        readFileAsDataURL(e.target.files[0]).then(function (u) {
          pendingCover = u;
          form.querySelector('#coverPrev').innerHTML = u ? '<img src="' + esc(u) + '" style="max-width:120px;border-radius:8px">' : '';
        });
      };
      form.querySelector('#cancelBtn').onclick = function () { formWrap.classList.add('hidden'); editingId = null; };
      form.querySelector('#fillBtn').onclick = function () {
        var cat = form.querySelector('#fillCat').value.trim();
        if (!cat) { toast('请输入 Catalog Number', 'err'); return; }
        VHDB.getConfig().then(function (cfg) {
          if (!cfg.discogsToken) { toast('请先在「系统设置」填写 Discogs Token', 'err'); return; }
          var b = form.querySelector('#fillBtn'); b.disabled = true; var old = b.textContent; b.textContent = '查询中…';
          return VHAPI.fetchDiscogs(cat, cfg.discogsToken, cfg.discogsProxy).then(function (list) {
            if (!list.length) { toast('未找到该 Catalog 的资料'); return; }
            var it = list[0];
            form.querySelector('[name=name]').value = it.album || '';
            form.querySelector('[name=singer]').value = it.artist || '';
            form.querySelector('[name=catalog]').value = it.catalog || '';
            form.querySelector('[name=version]').value = it.version || '';
            form.querySelector('[name=year]').value = it.year || '';
            form.querySelector('[name=label]').value = it.label || '';
            form.querySelector('[name=country]').value = it.country || '';
            if (it.cover) { pendingCover = it.cover; form.querySelector('#coverPrev').innerHTML = '<img src="' + esc(it.cover) + '" style="max-width:120px;border-radius:8px">'; }
            toast('已填充，请补充价格 / 数量 / 状态', 'ok');
          });
        }).catch(function (e) { toast('查询失败：' + e.message, 'err'); })
          .then(function () { var b = form.querySelector('#fillBtn'); if (b) { b.disabled = false; b.textContent = old; } });
      };
      form.onsubmit = function (e) {
        e.preventDefault();
        var f = e.target;
        var data = {
          cover: pendingCover,
          name: f.name.value.trim(), singer: f.singer.value.trim(), catalog: f.catalog.value.trim(),
          version: f.version.value.trim(), year: f.year.value.trim(), label: f.label.value.trim(),
          country: f.country.value.trim(), weight: f.weight.value.trim(), limited: f.limited.value.trim(),
          buyDate: f.buyDate.value, buyPrice: f.buyPrice.value === '' ? '' : Number(f.buyPrice.value),
          stockQty: Number(f.stockQty.value) || 0, status: f.status.value
        };
        if (!data.name) { toast('请填写黑胶名称', 'err'); return; }
        if (editingId != null) data.id = editingId;
        var p = data.id ? VHDB.put('inventory', data) : VHDB.add('inventory', data);
        p.then(function () { toast('已保存', 'ok'); formWrap.classList.add('hidden'); editingId = null; refresh(); })
          .catch(function (er) { toast('保存失败：' + er.message, 'err'); });
      };
    }

    function refresh() {
      var q = (search.value || '').toLowerCase();
      var st = filter.value;
      VHDB.getAll('inventory').then(function (rows) {
        rows = rows.filter(function (r) {
          var hit = !q || (r.name || '').toLowerCase().indexOf(q) >= 0 || (r.singer || '').toLowerCase().indexOf(q) >= 0 || (r.catalog || '').toLowerCase().indexOf(q) >= 0;
          var stOk = !st || r.status === st;
          return hit && stOk;
        });
        if (!rows.length) { listWrap.innerHTML = '<div class="empty">暂无库存，点击「＋ 添加库存」开始。</div>'; return; }
        listWrap.innerHTML = '<div class="list">' + rows.map(function (r) {
          var cover = r.cover ? '<img src="' + esc(r.cover) + '" alt="" style="width:52px;height:52px;object-fit:cover;border-radius:6px">' : '<div class="noimg">💿</div>';
          var cls = r.status === '已出售' ? 'bad' : 'good';
          return '<div class="item"><div class="body" style="display:flex;gap:12px;align-items:center">' + cover +
            '<div style="flex:1"><b>' + esc(r.name) + '</b> <span class="tag">' + esc(r.singer || '') + '</span>' +
            '<div class="meta">' + esc([r.catalog, r.version, r.year, r.label].filter(Boolean).join(' · ')) + '</div>' +
            '<div class="meta">库存数量：<b>' + (r.stockQty != null ? r.stockQty : 0) + '</b> 张 · 采购价 ' + (r.buyPrice !== '' && r.buyPrice != null ? fmtMoney(r.buyPrice) : '—') + ' · ' + esc(r.buyDate || '') + '</div></div>' +
            '<span class="tag ' + cls + '">' + esc(r.status) + '</span>' +
            '<div class="row-actions"><button class="btn btn-sm" data-edit="' + r.id + '">编辑</button>' +
            '<button class="btn btn-sm btn-danger" data-del="' + r.id + '">删除</button></div></div></div>';
        }).join('') + '</div>';
        $$('[data-edit]', listWrap).forEach(function (b) {
          b.onclick = function () { var it = rows.find(function (x) { return x.id == b.dataset.edit; }); editingId = it.id; buildForm(it); window.scrollTo({ top: 0, behavior: 'smooth' }); };
        });
        $$('[data-del]', listWrap).forEach(function (b) {
          b.onclick = function () { if (confirm('确认删除该库存记录？')) VHDB.del('inventory', Number(b.dataset.del)).then(function () { toast('已删除'); refresh(); }); };
        });
      });
    }
    node.querySelector('#addBtn').onclick = function () { editingId = null; buildForm({}); };
    search.oninput = refresh;
    filter.onchange = refresh;
    node._refresh = refresh;
    addClearButton(node, '🗑 清空库存', function () { return VHDB.clear('inventory'); });
    bindAI(node, 'inventory');
    bindAI(node, 'inventory_value');
    return { node: node, refresh: refresh };
  }

  /* ---------------- 客户 CRM（联动库存扣减） ---------------- */
  function buildCrm() {
    var node = elFrom('<div class="module"><div class="mod-head"><h2>👥 客户 CRM</h2>' +
      '<div class="mod-actions"><button class="btn btn-primary" id="addBtn">＋ 添加客户</button>' +
      '<button class="btn btn-collect" id="addBuy">＋ 添加购买记录</button></div></div>' +
      '<div class="hint">客户购买黑胶后，添加购买记录将<b>自动扣减库存数量</b>。专辑从「黑胶库存管理」中选择。</div>' +
      '<div class="form-wrap hidden" id="formWrap"></div>' +
      '<div class="list-wrap" id="listWrap"><div class="empty">加载中…</div></div>' + aiSectionHTML('crm') + '</div>');
    var listWrap = node.querySelector('#listWrap');
    var formWrap = node.querySelector('#formWrap');
    var editingId = null;

    function buildCustForm(item) {
      item = item || {};
      var html = '<form id="custForm"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<label>客户昵称<input type="text" name="name" value="' + esc(item.name) + '"></label>' +
        '<label>联系方式（可选）<input type="text" name="contact" value="' + esc(item.contact) + '"></label>' +
        '<label>喜欢歌手<input type="text" name="favArtist" value="' + esc(item.favArtist) + '"></label>' +
        '<label>收藏方向<input type="text" name="collectDir" value="' + esc(item.collectDir) + '" placeholder="如 周杰伦 / KPOP / 动漫"></label>' +
        '</div><div class="form-btns"><button type="submit" class="btn btn-primary">保存</button><button type="button" class="btn" id="cancelBtn">取消</button></div></form>';
      formWrap.innerHTML = html; formWrap.classList.remove('hidden');
      var form = formWrap.querySelector('#custForm');
      form.querySelector('#cancelBtn').onclick = function () { formWrap.classList.add('hidden'); editingId = null; };
      form.onsubmit = function (e) {
        e.preventDefault();
        var f = e.target;
        var data = { name: f.name.value.trim(), contact: f.contact.value.trim(), favArtist: f.favArtist.value.trim(), collectDir: f.collectDir.value.trim(), purchases: (item.purchases || []) };
        if (!data.name) { toast('请填写客户昵称', 'err'); return; }
        if (editingId != null) data.id = editingId;
        var p = data.id ? VHDB.put('crm', data) : VHDB.add('crm', data);
        p.then(function () { toast('已保存', 'ok'); formWrap.classList.add('hidden'); editingId = null; refresh(); })
          .catch(function (er) { toast('保存失败：' + er.message, 'err'); });
      };
    }

    function buildBuyForm() {
      Promise.all([VHDB.getAll('crm'), VHDB.getAll('inventory')]).then(function (r) {
        var customers = r[0], inv = r[1];
        if (!customers.length) { toast('请先添加客户', 'err'); return; }
        if (!inv.length) { toast('库存为空，请先添加库存', 'err'); return; }
        var html = '<form id="buyForm"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          '<label>客户<select name="custId">' + customers.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
          '<label>购买日期<input type="date" name="date" value="' + todayStr() + '"></label>' +
          '<label class="full">购买黑胶专辑<select name="invId">' + inv.map(function (i) { return '<option value="' + i.id + '">' + esc(i.name) + ' — ' + esc(i.catalog || '') + '（库存 ' + (i.stockQty != null ? i.stockQty : 0) + '）</option>'; }).join('') + '</select></label>' +
          '<label>购买数量<input type="number" min="1" name="qty" value="1"></label>' +
          '</div><div class="form-btns"><button type="submit" class="btn btn-primary">保存并记录</button><button type="button" class="btn" id="cancelBtn">取消</button></div></form>';
        formWrap.innerHTML = html; formWrap.classList.remove('hidden');
        var form = formWrap.querySelector('#buyForm');
        form.querySelector('#cancelBtn').onclick = function () { formWrap.classList.add('hidden'); };
        form.onsubmit = function (e) {
          e.preventDefault();
          var f = e.target;
          var custId = Number(f.custId.value), invId = Number(f.invId.value);
          var qty = Number(f.qty.value) || 0, date = f.date.value;
          if (qty < 1) { toast('购买数量至少 1', 'err'); return; }
          var rec = inv.find(function (x) { return x.id === invId; });
          if (!rec) { toast('库存记录不存在', 'err'); return; }
          if (qty > (rec.stockQty != null ? rec.stockQty : 0)) { toast('库存不足（当前 ' + (rec.stockQty != null ? rec.stockQty : 0) + ' 张）', 'err'); return; }
          var newQty = (rec.stockQty != null ? rec.stockQty : 0) - qty;
          var newStatus = newQty <= 0 ? '已出售' : '在售';
          VHDB.put('inventory', Object.assign({}, rec, { stockQty: newQty, status: newStatus })).then(function () {
            return VHDB.get('crm', custId).then(function (cust) {
              cust.purchases = cust.purchases || [];
              cust.purchases.unshift({ date: date, albumName: rec.name, catalog: rec.catalog, qty: qty, ts: new Date().toISOString() });
              return VHDB.put('crm', cust);
            });
          }).then(function () {
            toast('已记录，库存扣减至 ' + newQty + ' 张', 'ok');
            formWrap.classList.add('hidden');
            refresh();
          }).catch(function (er) { toast('保存失败：' + er.message, 'err'); });
        };
      });
    }

    function refresh() {
      VHDB.getAll('crm').then(function (rows) {
        if (!rows.length) { listWrap.innerHTML = '<div class="empty">暂无客户，点击「＋ 添加客户」开始。</div>'; return; }
        listWrap.innerHTML = '<div class="list">' + rows.map(function (r) {
          var buys = (r.purchases || []);
          var buyHtml = buys.length ? '<div class="meta">购买记录：</div>' + buys.map(function (b) {
            return '<div class="kv"><span class="kk">' + esc(b.date || '') + '</span><span class="vv">' + esc(b.albumName || '') + (b.catalog ? ' (' + esc(b.catalog) + ')' : '') + ' × ' + (b.qty || 1) + ' 张</span></div>';
          }).join('') : '<div class="meta">暂无购买记录</div>';
          return '<div class="item"><div class="body"><div class="row"><b>' + esc(r.name) + '</b>' +
            (r.collectDir ? '<span class="tag">' + esc(r.collectDir) + '</span>' : '') + '</div>' +
            (r.contact ? '<div class="meta">联系方式：' + esc(r.contact) + '</div>' : '') +
            (r.favArtist ? '<div class="meta">喜欢歌手：' + esc(r.favArtist) + '</div>' : '') +
            buyHtml + '</div>' +
            '<div class="row-actions"><button class="btn btn-sm" data-edit="' + r.id + '">编辑</button>' +
            '<button class="btn btn-sm btn-danger" data-del="' + r.id + '">删除</button></div></div>';
        }).join('') + '</div>';
        $$('[data-edit]', listWrap).forEach(function (b) {
          b.onclick = function () { var it = rows.find(function (x) { return x.id == b.dataset.edit; }); editingId = it.id; buildCustForm(it); window.scrollTo({ top: 0, behavior: 'smooth' }); };
        });
        $$('[data-del]', listWrap).forEach(function (b) {
          b.onclick = function () { if (confirm('确认删除该客户？')) VHDB.del('crm', Number(b.dataset.del)).then(function () { toast('已删除'); refresh(); }); };
        });
      });
    }
    node.querySelector('#addBtn').onclick = function () { editingId = null; buildCustForm({}); };
    node.querySelector('#addBuy').onclick = buildBuyForm;
    node._refresh = refresh;
    addClearButton(node, '🗑 清空客户', function () { return VHDB.clear('crm'); });
    bindAI(node, 'crm');
    return { node: node, refresh: refresh };
  }

  /* ---------------- 视图路由 ---------------- */
  var viewCache = {};
  // AI 使用记录（按模块累计 AI 分析次数）
  function buildAIUsage() {
    var MODULE_LABELS = {
      plan: '每日计划', auth: '黑胶真假鉴定', auth_checklist: 'AI鉴定检查清单', analysis: '黑胶全分析',
      inventory: '黑胶库存管理', inventory_value: '库存价值评估', hot: '每日热点', musicnews: '音乐新信息',
      discogs: 'Discogs黑胶数据库', crm: '客户CRM', websites: '唱片网址', fx: '实时汇率'
    };
    var node = elFrom('<div class="module"><div class="mod-head"><h2>📈 AI 使用记录</h2>' +
      '<div class="mod-actions"><button class="btn btn-danger" id="resetAi">🗑 清零统计</button></div></div>' +
      '<div class="hint">记录各模块累计调用 AI 分析的次数（含本地确定性算法与远程 AI）。每次点击 AI 分析按钮都会 +1。各模块标题右侧也有实时小角标。</div>' +
      '<div id="aiTotal" class="dash-grid" style="margin:12px 0"></div>' +
      '<div class="section-title">各模块明细</div><div id="aiList"><div class="empty">加载中…</div></div></div>');
    var totalEl = node.querySelector('#aiTotal');
    var listEl = node.querySelector('#aiList');

    function refresh() {
      getAllAIUsage().then(function (map) {
        var ids = Object.keys(MODULE_LABELS);
        var total = 0;
        ids.forEach(function (m) { total += (map[m] || 0); });
        totalEl.innerHTML = '<div class="stat-card"><div class="k">AI 总调用次数</div><div class="v">' + total + '</div><div class="meta">全部模块累计</div></div>' +
          '<div class="stat-card"><div class="k">已启用 AI 的模块</div><div class="v">' + ids.filter(function (m) { return map[m]; }).length + ' / ' + ids.length + '</div><div class="meta">含本地算法与远程 AI</div></div>';
        var rows = ids.map(function (m) {
          return { mid: m, label: MODULE_LABELS[m], count: map[m] || 0 };
        }).sort(function (a, b) { return b.count - a.count; });
        listEl.innerHTML = '<div class="list">' + rows.map(function (r) {
          var pct = total ? Math.round(r.count / total * 100) : 0;
          return '<div class="item"><div class="body" style="display:flex;gap:10px;align-items:center">' +
            '<div style="flex:1"><b>' + esc(r.label) + '</b> <span class="tag">' + esc(r.mid) + '</span>' +
            '<div class="meta">使用 ' + r.count + ' 次' + (total ? ' · 占比 ' + pct + '%' : '') + '</div>' +
            '<div class="mini-bar"><div class="mini-bar-fill" style="width:' + pct + '%"></div></div></div></div></div>';
        }).join('') + '</div>';
      });
    }
    node.querySelector('#resetAi').onclick = function () {
      if (!confirm('确认将全部模块的 AI 使用次数清零？此操作不可撤销。')) return;
      VHDB.clear('ai_usage').then(function () { toast('已清零 AI 使用记录', 'ok'); refresh(); });
    };
    node._refresh = refresh; refresh();
    return { node: node, refresh: refresh };
  }

  function getViewNode(id) {
    if (viewCache[id]) return viewCache[id].node;
    var mod;
    if (RECORD_CONFIGS[id]) mod = createRecordManager(RECORD_CONFIGS[id]);
    else if (id === 'dashboard') mod = buildDashboard();
    else if (id === 'datahub') mod = buildDataHub();
    else if (id === 'auth') mod = buildAuth();
    else if (id === 'websites') mod = buildWebsites();
    else if (id === 'discogs') mod = buildDiscogs();
    else if (id === 'analysis') mod = buildAnalysis();
    else if (id === 'inventory') mod = buildInventory();
    else if (id === 'crm') mod = buildCrm();
    else if (id === 'plan') mod = buildPlan();
    else if (id === 'aiusage') mod = buildAIUsage();
    else if (id === 'hot') mod = buildHot();
    else if (id === 'musicnews') mod = buildMusicNews();
    else if (id === 'fx') mod = buildFx();
    else if (id === 'backup') mod = buildBackup();
    else if (id === 'settings') mod = buildSettings();
    else mod = { node: elFrom('<div class="module"><div class="empty">模块开发中</div></div>'), refresh: function () {} };
    viewCache[id] = mod;
    return mod.node;
  }

  function showView(id) {
    var meta = NAV.find(function (n) { return n.id === id; });
    if (!meta) id = 'dashboard';
    $$('.nav-item').forEach(function (b) { b.classList.toggle('active', b.dataset.view === id); });
    $('#viewTitle').textContent = (NAV.find(function (n) { return n.id === id; }) || {}).label || '';
    var content = $('#content');
    content.innerHTML = '';
    var node = getViewNode(id);
    content.appendChild(node);
    if (viewCache[id] && viewCache[id].refresh) viewCache[id].refresh();
    $('#sidebar').classList.remove('open');
    $('#scrim').classList.remove('show');
    window.scrollTo({ top: 0 });
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    var nav = $('#nav');
    NAV.forEach(function (n) {
      var b = elFrom('<button class="nav-item" data-view="' + n.id + '"><span class="ni">' + n.icon + '</span><span class="nl">' + esc(n.label) + '</span></button>');
      b.onclick = function () { showView(n.id); };
      nav.appendChild(b);
    });
    $('#menuBtn').onclick = function () { $('#sidebar').classList.toggle('open'); $('#scrim').classList.toggle('show'); };
    $('#scrim').onclick = function () { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); };

    // 时钟
    function tick() {
      var d = new Date();
      var p = function (x) { return (x < 10 ? '0' : '') + x; };
      $('#clock').textContent = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    tick(); setInterval(tick, 30000);

    // PWA 注册（仅在 http/https 下，file:// 下跳过）
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }

    showView('dashboard');
    applyWorkbenchBg();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
