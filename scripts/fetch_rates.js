// scripts/fetch_rates.js
// 自動抓取滙豐(台灣)即期牌價並輸出 rates.json
const fs = require('fs');
const path = require('path');

async function fetchWithRetry(url, options, maxRetries = 3, delayMs = 3000) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      console.warn(`[第 ${attempt} 次] 伺服器回傳狀態碼 ${res.status} ${res.statusText}`);
    } catch (err) {
      lastErr = err;
      console.warn(`[第 ${attempt} 次] 請求失敗: ${err.message}`);
    }
    if (attempt < maxRetries) {
      console.log(`等待 ${delayMs / 1000} 秒後進行重試...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr || new Error(`在嘗試 ${maxRetries} 次後仍無法完成請求`);
}

async function fetchRates() {
  const url = 'https://www.hsbc.com.tw/currency-rates/';
  console.log(`正在請求滙豐官網: ${url}`);
  
  const res = await fetchWithRetry(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });

  const html = await res.text();
  const dateMatch = html.match(/匯率更新日期為[:：](?:&nbsp;|\s)*([^\n<]+)/);
  const updateTime = dateMatch ? dateMatch[1].trim() : new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

  const rows = {};
  const trRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  let match;
  while ((match = trRegex.exec(html)) !== null) {
    const tr = match[0];
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
    if (tds.length >= 5) {
      const name = tds[0];
      if (name.includes('USD') || name.includes('SGD') || name.includes('EUR') || 
          name.includes('JPY') || name.includes('GBP') || name.includes('AUD') || 
          name.includes('HKD') || name.includes('CAD') || name.includes('CHF') || 
          name.includes('CNY') || name.includes('NZD')) {
        const vals = tds.slice(1, 5).map(v => (v === '-' || !v) ? null : parseFloat(v));
        rows[name] = vals;
      }
    }
  }

  if (!rows['美金 (USD)'] || !rows['新加坡幣 (SGD)']) {
    throw new Error('未能在網頁中找到 USD 或 SGD 牌價');
  }

  const outputPath = path.resolve(__dirname, '../rates.json');
  let oldTime = null;
  if (fs.existsSync(outputPath)) {
    try {
      const oldData = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      oldTime = oldData.time;
    } catch (_) {}
  }

  const data = {
    time: updateTime,
    updatedAt: new Date().toISOString(),
    rows
  };

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`成功更新牌價資料至 ${outputPath}！`);
  console.log(`- 滙豐牌價時間: ${updateTime} (上次: ${oldTime || '無'})`);
  console.log(`- USD 即期買入: ${rows['美金 (USD)'][0]}`);
  console.log(`- SGD 即期賣出: ${rows['新加坡幣 (SGD)'][1]}`);
  return data;
}

fetchRates().catch(err => {
  console.error('抓取匯率失敗:', err);
  process.exit(1);
});
