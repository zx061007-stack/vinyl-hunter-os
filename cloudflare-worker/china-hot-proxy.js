/**
 * Vinyl Hunter OS — 中国热搜代理（Cloudflare Worker）
 * ----------------------------------------------------
 * 作用：转发微博 / 抖音热搜，合并去重，返回统一格式 { words: [...] }。
 *       同时带上 CORS 头，解决浏览器（github.io / localhost）直连被跨域拦截的问题。
 *
 * 部署：
 *   1. 安装 wrangler：npm i -g wrangler
 *   2. 新建项目：wrangler init china-hot-proxy --type javascript（选 "Hello World" 模板）
 *   3. 用本文件替换 src/index.js（或 worker 入口文件）
 *   4. 部署：wrangler deploy
 *   5. 部署后会得到一个 https://china-hot-proxy.<你的子域>.workers.dev 地址
 *   6. 把该地址填到 Vinyl Hunter OS → 系统设置 →「中国热搜代理地址」
 *
 * 注意：Worker 默认对请求来源开放 CORS（Access-Control-Allow-Origin: *），
 *       仅返回公开热搜词，不处理任何隐私数据，可放心使用。
 */
export default {
  async fetch(request) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json; charset=utf-8'
    };

    // 预检请求直接放行
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const results = [];
    const push = (arr) => {
      (arr || []).forEach((x) => {
        const w = x && (x.word || x.title || x.name || x);
        if (w && String(w).trim()) results.push(String(w).trim());
      });
    };

    // 1) 微博热搜
    try {
      const wb = await fetch('https://weibo.com/ajax/side/hot/search', {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://weibo.com/' }
      });
      const wd = await wb.json();
      push((wd && wd.data && wd.data.realtime) || []);
    } catch (e) { /* 忽略单项失败 */ }

    // 2) 抖音热搜
    try {
      const dy = await fetch('https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/', {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.douyin.com/' }
      });
      const dd = await dy.json();
      push(dd.word_list || []);
    } catch (e) { /* 忽略单项失败 */ }

    // 去重
    const seen = {};
    const words = [];
    results.forEach((w) => { if (!seen[w]) { seen[w] = 1; words.push(w); } });

    return new Response(JSON.stringify({ words: words.slice(0, 200), updatedAt: Date.now() }), {
      headers: corsHeaders
    });
  }
};
