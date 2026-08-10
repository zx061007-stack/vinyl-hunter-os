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

  /* ---------------- 导航配置（17 个模块） ---------------- */
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
      // 未配置自定义资讯源时，默认使用 MusicBrainz 全球发行库（免费、免 Key、支持 CORS）。
      var p = cfg.musicNewsSource
        ? VHAPI.fetchJson(cfg.musicNewsSource).then(function (data) {
            return Array.isArray(data) ? data : (data.items || []);
          })
        : VHAPI.fetchMusicBrainzNews();
      return p.then(function (items) {
        return VHDB.put('music_news', { date: todayStr(), items: items }).then(function () {
          toast('已采集 ' + items.length + ' 条音乐资讯（MusicBrainz）', 'ok');
        });
      });
    });
  }
  function collectHot() {
    return VHDB.getConfig().then(function (cfg) {
      if (!cfg.hotTopicSource) { toast('未配置热点源，请在系统设置配置或使用手动添加', 'err'); return; }
      return VHAPI.fetchJson(cfg.hotTopicSource).then(function (data) {
        var rec = { date: todayStr(), videos: data.videos || [], accounts: data.accounts || [], audios: data.audios || [] };
        return VHDB.put('hot_topics', rec).then(function () { toast('今日热点已采集', 'ok'); });
      });
    });
  }
  function collectAudio() {
    return VHDB.getConfig().then(function (cfg) {
      if (!cfg.audioSource) { toast('未配置热门音频源，请在系统设置配置或使用手动添加', 'err'); return; }
      return VHAPI.fetchJson(cfg.audioSource).then(function (data) {
        var audios = Array.isArray(data) ? data : (data.audios || []);
        return VHDB.get('hot_topics', todayStr()).then(function (rec) {
          rec = rec || { date: todayStr(), videos: [], accounts: [] };
          rec.audios = audios;
          return VHDB.put('hot_topics', rec).then(function () { toast('热门音频已采集', 'ok'); });
        });
      });
    });
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

    return { node: node, refresh: refresh };
  }

  /* ---------------- 派生计算（评分 / 利润 / 套利） ---------------- */
  // 选品评分：热度由系统自动估算（无需用户输入），利润 + 热度 + 收藏价值
  // 黑胶全分析：综合评分引擎（本地确定性算法，不消耗 Token）
  // 输入 d 需含：name/artist/catalog/version/versionInfo/year/company/country
  //   可选 Discogs 社区数据：want/have/numForSale
  //   用户填写：buyPrice（购入价）/presalePrice（预售价）
  // 输出：versionValue/overseasHot(+level/text)/chinaHot(+level/text)/collectValue/
  //       score/level/profit/margin/advice/reason
  function analyzeVinyl(d, chinaHotWords) {
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

    // 三、中国热度（优先用微博/抖音热搜匹配活跃度；无数据则本地估算）
    var estBase = clamp(Math.round(overseasHot * 0.82 + (vLimited ? 6 : 0) + (vFirst ? 4 : 0) - 6), 30, 95);
    var hotWords = Array.isArray(chinaHotWords) ? chinaHotWords : [];
    var chinaHot, chinaText, chinaSource;
    if (hotWords.length) {
      // 用歌手 / 厂牌（识别度高的实体）以及专辑名显著词去匹配热搜
      var keywords = [d.artist, d.company].filter(function (k) { return k && String(k).trim().length >= 2; })
        .map(function (k) { return String(k).trim(); })
        .concat(String(d.name || '').split(/[\s\-–—/]+/).filter(function (w) { return w.length >= 3; }));
      var hits = [];
      hotWords.forEach(function (w) {
        keywords.forEach(function (k) {
          if (w && (w.indexOf(k) >= 0 || k.indexOf(w) >= 0) && hits.indexOf(k) < 0) hits.push(k);
        });
      });
      var base = clamp(Math.round(overseasHot * 0.7 + (vLimited ? 6 : 0) + (vFirst ? 4 : 0) - 6), 30, 92);
      if (hits.length) {
        var bonus = hits.length >= 3 ? 35 : hits.length === 2 ? 28 : 18;
        chinaHot = clamp(base + bonus, 30, 100);
        chinaSource = '微博/抖音热搜命中';
        chinaText = '基于微博/抖音热搜数据（共 ' + hotWords.length + ' 条）匹配到歌手/厂牌关键词：' + hits.join('、') +
          '（' + hits.length + ' 处命中）。中国社交平台讨论热度高，粉丝需求与收藏市场预期强。';
      } else {
        chinaHot = clamp(base, 30, 95);
        chinaSource = '微博/抖音热搜（未命中）';
        chinaText = '已接入微博/抖音热搜数据（共 ' + hotWords.length + ' 条），未匹配到该艺人/厂牌，结合版本稀缺度与海外需求频率推算中国市场需求中等或有限。';
      }
    } else {
      chinaHot = estBase;
      chinaSource = '参考估算（未配置热搜代理）';
      chinaText = '（参考估算）未配置中国热搜代理地址，基于海外需求频率与版本稀缺度推算。如需真实中国热度，请在系统设置填写热搜代理地址。' +
        (chinaHot >= 75 ? '中国粉丝需求与收藏市场预期较高。' : chinaHot >= 60 ? '中国市场需求中等。' : '中国市场认知度与需求相对有限。');
    }

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
    d.chinaHot = chinaHot; d.chinaLevel = chinaLevel; d.chinaText = chinaText; d.chinaSource = chinaSource;
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
      title: '消费记账', store: 'expenses',
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
      { label: '采集今日热点', fn: collectHot },
      { label: '采集热门音频', fn: collectAudio }
    ];
    var node = elFrom('<div class="module"><h2>数据采集中心</h2>' +
      '<div class="hint">所有数据均需你主动点击按钮才会采集，<b>不会自动联网</b>，以节省 Token / API 额度。未配置数据源时，请在各模块使用「新增」手动录入。</div>' +
      '<div class="dash-grid" id="hubGrid"></div></div>');
    node._refresh = function () {};
    var grid = $('#hubGrid', node);
    actions.forEach(function (a) {
      var card = elFrom('<div class="stat-card"><div class="k">' + esc(a.label) + '</div>' +
        '<button class="btn btn-collect" style="margin-top:12px;width:100%">🔄 开始采集</button></div>');
      card.querySelector('button').onclick = function () {
        var b = card.querySelector('button'); b.disabled = true; var old = b.textContent; b.textContent = '采集中…';
        a.fn().catch(function (e) { toast('采集失败：' + e.message, 'err'); })
          .then(function () { b.disabled = false; b.textContent = old; });
      };
      grid.appendChild(card);
    });
    return { node: node, refresh: node._refresh };
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
      '<div class="list-wrap" id="listWrap"><div class="empty">加载中…</div></div></div>');
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
      '<div class="list" id="planList"></div></div>');
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
    return { node: node, refresh: refresh };
  }

  // 每日热点
  function buildHot() {
    var node = elFrom('<div class="module"><div class="mod-head"><h2>每日热点</h2>' +
      '<div class="mod-actions">' +
      '<button class="btn btn-collect" id="cHot">🔥 采集今日热点</button>' +
      '<button class="btn btn-collect" id="cVideo">🎬 采集抖音热门视频</button>' +
      '<button class="btn btn-collect" id="cAudio">🎧 采集热门音频</button>' +
      '</div></div>' +
      '<div class="hint">重点抖音热点。未配置数据源时，可使用下方表单手动添加。</div>' +
      '<details class="form-wrap"><summary style="cursor:pointer;font-weight:600">＋ 手动添加视频</summary>' +
      '<form id="vForm" style="margin-top:10px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<label>视频标题<input name="title"></label><label>视频链接<input name="link"></label>' +
      '<label>作者名字<input name="author"></label><label>账号名称<input name="account"></label>' +
      '<label>账号主页<input name="homepage"></label><label>点赞数量<input name="likes"></label>' +
      '<label>评论数量<input name="comments"></label></div>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-top:8px">爆火原因<textarea name="reason"></textarea></label>' +
      '<div class="form-btns"><button class="btn btn-primary">添加</button></div></form></details>' +
      '<div class="section-title">热门视频</div><div id="vList" class="list"></div>' +
      '<div class="section-title">每日筛选 · 3 个热门账号</div><div id="aList" class="list"></div>' +
      '<div class="section-title">热门音频</div><div id="auList" class="list"></div></div>');

    function refresh() {
      VHDB.get('hot_topics', todayStr()).then(function (rec) {
        rec = rec || { videos: [], accounts: [], audios: [] };
        var videos = rec.videos || [], accounts = rec.accounts || [], audios = rec.audios || [];
        node.querySelector('#vList').innerHTML = videos.length ? videos.map(function (v) {
          return '<div class="item"><div class="body"><b>' + esc(v.title) + '</b>' +
            '<div class="meta">' + esc([v.author, v.account].filter(Boolean).join(' · ')) + '</div>' +
            '<div class="meta">👍 ' + esc(v.likes) + ' · 💬 ' + esc(v.comments) + '</div>' +
            '<div class="meta">爆火原因：' + esc(v.reason) + '</div>' +
            (v.link ? '<div class="meta"><a href="' + esc(v.link) + '" target="_blank" rel="noopener">查看视频</a></div>' : '') +
            (v.homepage ? '<div class="meta"><a href="' + esc(v.homepage) + '" target="_blank" rel="noopener">账号主页</a></div>' : '') +
            '</div></div>';
        }).join('') : '<div class="empty">暂无，点击「采集」或手动添加</div>';
        node.querySelector('#aList').innerHTML = accounts.length ? accounts.slice(0, 3).map(function (a) {
          return '<div class="item"><div class="body"><b>' + esc(a.author) + '</b> <span class="tag">' + esc(a.account) + '</span>' +
            '<div class="meta">内容方向：' + esc(a.dir) + '</div></div></div>';
        }).join('') : '<div class="empty">暂无</div>';
        node.querySelector('#auList').innerHTML = audios.length ? audios.map(function (a) {
          return '<div class="item"><div class="body"><b>' + esc(a.name) + '</b> — ' + esc(a.singer) +
            '<div class="meta">使用情况：' + esc(a.usage) + ' · 热门原因：' + esc(a.reason) + '</div></div></div>';
        }).join('') : '<div class="empty">暂无</div>';
      });
    }
    ['cHot', 'cVideo'].forEach(function (id) {
      node.querySelector('#' + id).onclick = function () { collectHot().then(refresh).catch(function (e) { toast('采集失败：' + e.message, 'err'); refresh(); }); };
    });
    node.querySelector('#cAudio').onclick = function () { collectAudio().then(refresh).catch(function (e) { toast('采集失败：' + e.message, 'err'); refresh(); }); };
    node.querySelector('#vForm').onsubmit = function (e) {
      e.preventDefault(); var f = e.target; var v = {
        title: f.title.value, link: f.link.value, author: f.author.value, account: f.account.value,
        homepage: f.homepage.value, likes: f.likes.value, comments: f.comments.value, reason: f.reason.value
      };
      VHDB.get('hot_topics', todayStr()).then(function (rec) {
        rec = rec || { date: todayStr(), accounts: [], audios: [] };
        rec.videos = rec.videos || []; rec.videos.unshift(v);
        return VHDB.put('hot_topics', rec);
      }).then(function () { f.reset(); toast('已添加', 'ok'); refresh(); });
    };
    node._refresh = refresh;
    return { node: node, refresh: refresh };
  }

  // 音乐新信息
  function buildMusicNews() {
    var node = elFrom('<div class="module"><div class="mod-head"><h2>音乐新信息</h2>' +
      '<div class="mod-actions"><button class="btn btn-collect" id="cNews">🎵 采集全球音乐资讯</button></div></div>' +
      '<div class="hint">默认使用 <b>MusicBrainz</b> 全球发行库（免费 · 免 Key · 支持 CORS，覆盖多地区）；点「采集」即取今日新发行。你也可在「系统设置」填入自定义资讯源 JSON 覆盖。</div>' +
      '<details class="form-wrap"><summary style="cursor:pointer;font-weight:600">＋ 手动添加资讯</summary>' +
      '<form id="nForm" style="margin-top:10px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<label>地区<select name="region"><option>日本</option><option>韩国</option><option>美国</option><option>欧洲</option><option>中国港台</option></select></label>' +
      '<label>歌手<input name="artist"></label><label>专辑<input name="album"></label>' +
      '<label>发布时间<input name="releaseDate"></label><label>格式<select name="format"><option>CD</option><option>黑胶</option><option>数字</option></select></label>' +
      '<label>售价<input name="price"></label><label>出版公司<input name="company"></label>' +
      '<label>出版国家<input name="country"></label><label>购买链接<input name="buyLink"></label>' +
      '<label class="full">来源链接<input name="srcLink"></label></div>' +
      '<div class="form-btns"><button class="btn btn-primary">添加</button></div></form></details>' +
      '<div id="nList" class="list"></div></div>');

    function refresh() {
      VHDB.get('music_news', todayStr()).then(function (rec) {
        var items = rec && rec.items ? rec.items : [];
        node.querySelector('#nList').innerHTML = items.length ? items.map(function (it) {
          var thumb = it.cover
            ? '<img src="' + esc(it.cover) + '" class="news-thumb" alt="" onerror="this.style.display=\'none\'">'
            : '';
          return '<div class="item"><div class="body" style="display:flex;gap:10px;align-items:flex-start">' + thumb +
            '<div style="flex:1"><b>' + esc(it.artist) + '</b> — ' + esc(it.album) +
            ' <span class="tag">' + esc(it.region) + '</span> <span class="tag">' + esc(it.format) + '</span>' +
            '<div class="meta">发布：' + esc(it.releaseDate) + ' · 售价：' + esc(it.price) + ' · ' + esc(it.company) + ' / ' + esc(it.country) + '</div>' +
            '<div class="meta">' + (it.buyLink ? '<a href="' + esc(it.buyLink) + '" target="_blank" rel="noopener">购买</a> ' : '') + (it.srcLink ? '<a href="' + esc(it.srcLink) + '" target="_blank" rel="noopener">来源</a>' : '') + '</div>' +
            '</div></div></div>';
        }).join('') : '<div class="empty">暂无，点击「采集」或手动添加</div>';
      });
    }
    node.querySelector('#cNews').onclick = function () { collectMusicNews().then(refresh).catch(function (e) { toast('采集失败：' + e.message, 'err'); refresh(); }); };
    node.querySelector('#nForm').onsubmit = function (e) {
      e.preventDefault(); var f = e.target; var it = {
        region: f.region.value, artist: f.artist.value, album: f.album.value, releaseDate: f.releaseDate.value,
        format: f.format.value, price: f.price.value, company: f.company.value, country: f.country.value,
        buyLink: f.buyLink.value, srcLink: f.srcLink.value
      };
      VHDB.get('music_news', todayStr()).then(function (rec) {
        rec = rec || { date: todayStr(), items: [] };
        rec.items = rec.items || []; rec.items.unshift(it);
        return VHDB.put('music_news', rec);
      }).then(function () { f.reset(); toast('已添加', 'ok'); refresh(); });
    };
    node._refresh = refresh;
    return { node: node, refresh: refresh };
  }

  // 实时汇率（含汇率换算）
  function buildFx() {
    var CUR = ['USD', 'HKD', 'TWD', 'JPY', 'KRW', 'GBP', 'EUR'];
    var LABELS = { USD: '美元', HKD: '港币', TWD: '台币', JPY: '日元', KRW: '韩元', GBP: '英镑', EUR: '欧元' };
    var node = elFrom('<div class="module"><div class="mod-head"><h2>实时汇率</h2>' +
      '<div class="mod-actions"><button class="btn btn-collect" id="cFx">💲 更新今日汇率</button></div></div>' +
      '<div class="hint">显示 1 单位外币兑换多少人民币（CNY）。数据永久保存，可查看历史。下方支持汇率换算。</div>' +
      '<div class="card"><h3>汇率换算</h3>' +
      '<div class="conv-row"><input type="number" id="convAmt" placeholder="金额" step="any">' +
      '<select id="convCur">' + CUR.map(function (c) { return '<option value="' + c + '">' + (LABELS[c] || c) + ' (' + c + ')</option>'; }).join('') + '</select>' +
      '<button class="btn btn-primary" id="convBtn">换算 → CNY</button></div>' +
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
      var cur = node.querySelector('#convCur').value;
      if (!amt) { toast('请输入金额', 'err'); return; }
      VHDB.get('exchange_rates', todayStr()).then(function (rec) {
        if (!rec || !rec.rates || !rec.rates[cur]) { toast('请先更新今日汇率', 'err'); return; }
        var cny = amt * rec.rates[cur];
        node.querySelector('#convRes').textContent = fmtMoney(cny) + '  (1 ' + cur + ' = ' + Number(rec.rates[cur]).toFixed(4) + ' CNY)';
      });
    };
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
    return { node: node, refresh: refresh };
  }

  // 系统设置
  function buildSettings() {
    var node = elFrom('<div class="module"><h2>系统设置</h2>' +
      '<div class="form-wrap"><form id="cfgForm">' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">显示名称<input name="displayName"></label>' +
      '<label style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">主题<select name="theme"><option value="light">浅色（米白）</option><option value="dark">墨绿深色</option></select></label>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">Discogs Token（用于黑胶资料查询）<input name="discogsToken" placeholder="在 discogs.com/settings/developers 申请"></label>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">Discogs 代理地址（可选，解决浏览器跨域；Cloudflare Worker 等，留空走直连）<input name="discogsProxy" placeholder="https://你的worker.dev"></label>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">中国热搜代理地址（可选，用于黑胶全分析的中国热度。部署 Cloudflare Worker 转发微博/抖音热搜，留空则中国热度使用本地估算）<input name="chinaHotProxy" placeholder="https://你的热搜worker.dev"></label>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">音乐资讯源（返回 JSON 数组或 {items:[...]} 的 URL）<input name="musicNewsSource"></label>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">抖音热点源（返回 {videos:[...],accounts:[...]} 的 URL）<input name="hotTopicSource"></label>' +
      '<label class="full" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">热门音频源（返回数组或 {audios:[...]} 的 URL）<input name="audioSource"></label>' +
      '<div class="form-btns"><button type="submit" class="btn btn-primary">保存设置</button></div>' +
      '</form></div>' +
      '<div class="hint">未配置数据源时，各采集按钮会提示手动添加；手动录入始终是可靠主路径。汇率接口为免费公共服务，无需配置即可使用。</div></div>');
    VHDB.getConfig().then(function (cfg) {
      var f = node.querySelector('#cfgForm');
      ['displayName', 'theme', 'discogsToken', 'discogsProxy', 'chinaHotProxy', 'musicNewsSource', 'hotTopicSource', 'audioSource'].forEach(function (k) {
        if (cfg[k] != null) f[k].value = cfg[k];
      });
      applyTheme(cfg.theme || 'light');
    });
    node.querySelector('#cfgForm').onsubmit = function (e) {
      e.preventDefault(); var f = e.target;       var cfg = {
        displayName: f.displayName.value, theme: f.theme.value, discogsToken: f.discogsToken.value,
        discogsProxy: f.discogsProxy.value,
        chinaHotProxy: f.chinaHotProxy.value,
        musicNewsSource: f.musicNewsSource.value, hotTopicSource: f.hotTopicSource.value,
        audioSource: f.audioSource.value
      };
      VHDB.setConfig(cfg).then(function () { applyTheme(cfg.theme); toast('设置已保存', 'ok'); });
    };
    node._refresh = function () {};
    return { node: node, refresh: function () {} };
  }
  function applyTheme(t) { document.documentElement.setAttribute('data-theme', t || 'light'); }

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
      var chinaHtml = '<div class="card"><h3>三、中国市场热度分析</h3>' + levelBadge(r.chinaHot) +
        '<div class="meta">数据来源：' + esc(r.chinaSource || '参考估算') + '</div>' +
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
      resultEl.innerHTML = baseHtml + overseaHtml + chinaHtml + scoreHtml + profitHtml + adviceHtml;
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
      }).then(function (words) {
        analyzeVinyl(rec, words);
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
      '<div class="section-title">查询结果</div>' +
      '<div id="dResults"><div class="empty">输入查询条件后点击「查询专辑信息」。</div></div>' +
      '<div class="section-title">专辑详情</div>' +
      '<div id="dDetail"><div class="empty">点击某条结果「查看详情」查看完整资料。</div></div></div>');

    var resultsEl = node.querySelector('#dResults');
    var detailEl = node.querySelector('#dDetail');
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
            return '<div class="item"><div class="body" style="display:flex;gap:12px;align-items:center">' + cover +
              '<div style="flex:1"><b>' + esc(it.artist || '') + (it.album ? ' — ' + esc(it.album) : '') + '</b>' +
              '<div class="meta">' + esc([it.year, it.country, it.catalog].filter(Boolean).join(' · ')) + '</div>' +
              '<div class="meta">' + esc(it.version || '') + '</div></div>' +
              '<div class="row-actions"><button class="btn btn-sm" data-detail="' + i + '">查看详情</button>' +
              '<button class="btn btn-sm" data-ana="' + i + '">进入全分析</button>' +
              '<button class="btn btn-sm btn-primary" data-save="' + i + '">保存到库存</button></div></div></div>';
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
        });
      }).catch(function (e) { toast('查询失败：' + e.message, 'err'); })
        .then(function () { b.disabled = false; b.textContent = old; });
    };

    function showDetail(idx, cfg) {
      var it = currentResults[idx];
      selected = it;
      detailEl.innerHTML = '<div class="empty">加载详情中…</div>';
      var p = it.id
        ? VHAPI.fetchDiscogsRelease(it.id, cfg.discogsToken, cfg.discogsProxy)
        : Promise.resolve(it);
      p.then(function (d) {
        d = d || it;
        var cover = d.cover ? '<img src="' + esc(d.cover) + '" alt="封面" style="max-width:160px;border-radius:8px">' : '';
        var imgs = (d.images || []).slice(0, 4).map(function (u) { return '<img src="' + esc(u) + '" alt="" style="width:80px;height:80px;object-fit:cover;border-radius:6px">'; }).join('');
        detailEl.innerHTML =
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
          (imgs ? '<div class="section-title">图片</div><div class="thumbs">' + imgs + '</div>' : '') +
          '<div class="form-btns"><button class="btn" id="anaDetail">进入黑胶全分析</button>' +
          '<button class="btn btn-primary" id="saveDetail">保存到黑胶库存</button></div></div>';
        detailEl.querySelector('#anaDetail').onclick = function () { sendToAnalysis(d); };
        detailEl.querySelector('#saveDetail').onclick = function () { saveToInventory(d); };
      }).catch(function (e) { detailEl.innerHTML = '<div class="empty">详情加载失败：' + esc(e.message) + '</div>'; });
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
      '<div class="list-wrap" id="listWrap"><div class="empty">加载中…</div></div></div>');
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
    return { node: node, refresh: refresh };
  }

  /* ---------------- 客户 CRM（联动库存扣减） ---------------- */
  function buildCrm() {
    var node = elFrom('<div class="module"><div class="mod-head"><h2>👥 客户 CRM</h2>' +
      '<div class="mod-actions"><button class="btn btn-primary" id="addBtn">＋ 添加客户</button>' +
      '<button class="btn btn-collect" id="addBuy">＋ 添加购买记录</button></div></div>' +
      '<div class="hint">客户购买黑胶后，添加购买记录将<b>自动扣减库存数量</b>。专辑从「黑胶库存管理」中选择。</div>' +
      '<div class="form-wrap hidden" id="formWrap"></div>' +
      '<div class="list-wrap" id="listWrap"><div class="empty">加载中…</div></div></div>');
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
    return { node: node, refresh: refresh };
  }

  /* ---------------- 视图路由 ---------------- */
  var viewCache = {};
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
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
