/**
 * Vinyl Hunter OS — 中国热搜代理 + AI 分析代理（Cloudflare Worker）
 * ----------------------------------------------------
 * 两个路由：
 *   GET  /           → 转发微博/抖音热搜，合并去重，返回 { words: [...] }
 *   POST /ai-analyze → 代理调 DeepSeek API，Key 存 Worker 端不泄露
 *
 * 部署：
 *   1. npm i -g wrangler
 *   2. wrangler init vinyl-proxy --type javascript（选 "Hello World"）
 *   3. 用本文件替换 src/index.js
 *   4. 设置 DeepSeek API Key（密钥存 Cloudflare，不进代码/聊天）：
 *        wrangler secret put DEEPSEEK_API_KEY
 *      粘贴你的 Key 回车即可
 *   5. wrangler deploy
 *   6. 部署后得到 https://vinyl-proxy.<子域>.workers.dev
 *   7. 系统设置 →「中国热搜代理地址」填 https://vinyl-proxy.<子域>.workers.dev
 *      系统设置 →「AI分析代理地址」填 https://vinyl-proxy.<子域>.workers.dev/ai-analyze
 *
 * 计费：Cloudflare Workers 免费档 10 万次/天，个人黑胶分析用量远不到。
 *       DeepSeek API 按量计费，一次分析约 0.005 元，极低。
 */
export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json; charset=utf-8'
    };

    // 预检请求直接放行
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ========== 路由 1：AI 分析 ==========
    if (url.pathname === '/ai-analyze' && request.method === 'POST') {
      const apiKey = env && env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Worker 未配置 DEEPSEEK_API_KEY，请用 wrangler secret put DEEPSEEK_API_KEY 设置' }), { status: 500, headers: corsHeaders });
      }

      try {
        const body = await request.json();
        const systemPrompt = body.systemPrompt || '你是黑胶商业分析助手。';
        const userPrompt = body.userPrompt || '';

        const resp = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            max_tokens: 2000,
            temperature: 0.7
          })
        });

        if (!resp.ok) {
          const errText = await resp.text();
          return new Response(JSON.stringify({ error: 'DeepSeek API 返回 ' + resp.status + ': ' + errText.slice(0, 200) }), { status: 502, headers: corsHeaders });
        }

        const data = await resp.json();
        const result = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || 'AI 返回为空';

        return new Response(JSON.stringify({
          ok: true,
          result: result,
          model: data.model || 'deepseek-chat',
          usage: data.usage || {}
        }), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'AI 分析异常：' + e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ========== 路由 2：中国热搜代理（原有功能） ==========
    const results = [];
    const push = (arr) => {
      (arr || []).forEach((x) => {
        const w = x && (x.word || x.title || x.name || x);
        if (w && String(w).trim()) results.push(String(w).trim());
      });
    };

    // 微博热搜
    try {
      const wb = await fetch('https://weibo.com/ajax/side/hot/search', {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://weibo.com/' }
      });
      const wd = await wb.json();
      push((wd && wd.data && wd.data.realtime) || []);
    } catch (e) { /* 忽略单项失败 */ }

    // 抖音热搜
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
