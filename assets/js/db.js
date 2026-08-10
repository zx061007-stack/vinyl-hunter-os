/* ============================================================
 * Vinyl Hunter OS — 持久化层 (IndexedDB)
 * 所有数据永久保存在浏览器本地，刷新/关闭/隔天均不丢失。
 * 不使用 SessionStorage / 临时缓存 / 页面变量。
 * ============================================================ */
(function (global) {
  'use strict';

  var DB_NAME = 'vinyl_hunter_os';
  var DB_VERSION = 3;

  // 所有对象仓库（已按精简后的 17 个模块裁剪；选品评分+套利分析已合并为 full_analysis）
  var STORES = [
    'daily_plans',     // 每日计划 (key=date)
    'hot_topics',      // 每日热点 (key=date)
    'music_news',      // 音乐新信息 (key=date)
    'exchange_rates',  // 实时汇率 (key=date)
    'expenses',        // 消费记账 (auto id)
    'discogs_db',      // Discogs 黑胶数据库 (auto id)
    'websites',       // 唱片网址收藏 (auto id)
    'auth_records',    // 真假鉴定记录 (auto id)
    'profit_calcs',    // 利润计算记录 (auto id)
    'full_analysis',   // 黑胶全分析记录（合并原选品评分+套利分析）(auto id)
    'inventory',       // 库存记录 (auto id)
    'crm',             // 客户 CRM (auto id)
    'ai_analyses',     // AI 分析结果（全局，按模块+时间）(auto id)
    'settings'         // 系统设置 (key=__key)
  ];

  // v1 -> v2：移除已合并的 selection_scores / arbitrage 仓库，新建 full_analysis。
  var OBSOLETE_STORES = ['selection_scores', 'arbitrage'];

  // 以日期/配置为键的仓库（不使用自增 id）
  var KEYED_STORES = {
    daily_plans: 'date',
    hot_topics: 'date',
    music_news: 'date',
    exchange_rates: 'date',
    settings: '__key'
  };

  var _db = null;

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (_db) return resolve(_db);
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        // 清理已合并/废弃的仓库
        OBSOLETE_STORES.forEach(function (s) {
          if (db.objectStoreNames.contains(s)) db.deleteObjectStore(s);
        });
        STORES.forEach(function (s) {
          if (!db.objectStoreNames.contains(s)) {
            if (KEYED_STORES[s]) {
              db.createObjectStore(s, { keyPath: KEYED_STORES[s] });
            } else {
              db.createObjectStore(s, { keyPath: 'id', autoIncrement: true });
            }
          }
        });
      };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(store, mode) {
    return openDB().then(function (db) {
      return db.transaction(store, mode).objectStore(store);
    });
  }

  function reqToPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function dbGetAll(store) {
    return tx(store, 'readonly').then(function (os) { return reqToPromise(os.getAll()); });
  }

  function dbGet(store, key) {
    return tx(store, 'readonly').then(function (os) { return reqToPromise(os.get(key)); });
  }

  function dbAdd(store, item) {
    return tx(store, 'readwrite').then(function (os) { return reqToPromise(os.add(item)); });
  }

  function dbPut(store, item) {
    return tx(store, 'readwrite').then(function (os) { return reqToPromise(os.put(item)); });
  }

  function dbDelete(store, key) {
    return tx(store, 'readwrite').then(function (os) { return reqToPromise(os.delete(key)); });
  }

  function dbClear(store) {
    return tx(store, 'readwrite').then(function (os) { return reqToPromise(os.clear()); });
  }

  function clearAll() {
    return Promise.all(STORES.map(dbClear));
  }

  // 导出全部数据为 JSON 对象
  function exportAll() {
    return Promise.all(STORES.map(function (s) {
      return dbGetAll(s).then(function (rows) { return [s, rows]; });
    })).then(function (pairs) {
      var data = {};
      pairs.forEach(function (p) { data[p[0]] = p[1]; });
      return {
        app: 'Vinyl Hunter OS',
        schema: DB_VERSION,
        exportedAt: new Date().toISOString(),
        data: data
      };
    });
  }

  // 从 JSON 对象恢复（先清空再写入，保留原有 id/key）
  function importAll(payload) {
    if (!payload || !payload.data) throw new Error('数据格式不正确');
    return clearAll().then(function () {
      return Promise.all(STORES.map(function (s) {
        var rows = payload.data[s] || [];
        return Promise.all(rows.map(function (r) { return dbPut(s, r); }));
      }));
    });
  }

  // 系统配置读写（保存在 settings 仓库 __key='config'）
  function getConfig() {
    return dbGet('settings', 'config').then(function (r) {
      return (r && r.value) ? r.value : {};
    });
  }

  function setConfig(value) {
    return dbPut('settings', { __key: 'config', value: value });
  }

  global.VHDB = {
    STORES: STORES,
    openDB: openDB,
    getAll: dbGetAll,
    get: dbGet,
    add: dbAdd,
    put: dbPut,
    del: dbDelete,
    clear: dbClear,
    clearAll: clearAll,
    exportAll: exportAll,
    importAll: importAll,
    getConfig: getConfig,
    setConfig: setConfig
  };
})(window);
