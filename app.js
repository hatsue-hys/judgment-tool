/**
 * デイトレ判断補助ツール - ロジック & DOM 操作
 *
 * ─── ファイル構成の意図 ────────────────────────────────────
 * index.html → 「何を表示するか」の骨格
 * style.css  → 「どう見せるか」のデザイン
 * app.js     → 「どう動くか」のロジック
 * ──────────────────────────────────────────────────────────
 */

'use strict';

/* ============================================================
   LAYER 1: 純粋計算関数 ── 短期（デイトレ）
   ============================================================ */

function calcMarketScore(sentiment) {
  return { good: 2, normal: 0, bad: -2 }[sentiment] ?? 0;
}

function calcFocusScore(focus) {
  return { 1: -2, 2: -1, 3: 0, 4: 1, 5: 2 }[focus] ?? 0;
}

function calcPricePositionScore(currentPrice, prevHigh, prevLow) {
  if (currentPrice > prevHigh)          return { score: -2, position: 'above_high' };
  if (currentPrice < prevLow)           return { score: -3, position: 'below_low' };
  if (currentPrice <= prevLow  * 1.01)  return { score:  1, position: 'near_support' };
  if (currentPrice >= prevHigh * 0.99)  return { score: -1, position: 'near_resistance' };
  return { score: 0, position: 'range' };
}

function calcStopLoss(currentPrice, prevLow, market) {
  const round = market === 'us'
    ? (v) => Math.round(v * 100) / 100
    : (v) => Math.floor(v);
  return currentPrice > prevLow ? round(prevLow * 0.995) : round(currentPrice * 0.98);
}

function calcEntrySignal({ totalScore, focus, sentiment }) {
  if (focus <= 2)                        return { signal: 'ng',    label: '触るな',       reason: '集中度が低すぎます（ハードルール）' };
  if (sentiment === 'bad' && focus < 4)  return { signal: 'ng',    label: '触るな',       reason: '地合い悪＋集中度不足（ハードルール）' };
  if (totalScore >= 3)                   return { signal: 'ok',    label: 'エントリー OK', reason: `スコア ${totalScore}：条件良好` };
  if (totalScore >= 0)                   return { signal: 'watch', label: '様子見',       reason: `スコア ${totalScore}：条件が揃っていない` };
  return                                        { signal: 'ng',    label: '触るな',       reason: `スコア ${totalScore}：条件が悪すぎる` };
}

function calcPositionSize({ score, currentPrice, stopLoss, focus, sentiment }) {
  const riskPercent = (currentPrice - stopLoss) / currentPrice * 100;
  if (score >= 4 && riskPercent <= 2 && focus >= 4 && sentiment === 'good')
    return { size: 'large',  label: '大',   reason: `スコア${score}・リスク${riskPercent.toFixed(1)}%・集中${focus}・地合い良の4条件が揃いました` };
  if (score >= 2 && riskPercent <= 3 && focus >= 3)
    return { size: 'medium', label: '中',   reason: `スコア${score}・リスク${riskPercent.toFixed(1)}%・集中${focus}が条件を満たしています` };
  if (score >= 0 && riskPercent <= 5)
    return { size: 'small',  label: '小',   reason: `リスク${riskPercent.toFixed(1)}%は許容範囲ですが、条件が不十分です` };
  return   { size: 'pass',   label: '見送り', reason: `リスク${riskPercent.toFixed(1)}%が大きすぎるか、条件が揃っていません` };
}

function calcRiskWarningsShort({ focus, sentiment, currentPrice, prevHigh, prevLow, volume }) {
  const w = [];
  if (focus <= 2)                       w.push({ level: 'critical', message: '集中度が低すぎます。今日の取引は避けてください。' });
  else if (focus === 3)                 w.push({ level: 'warning',  message: '集中度がやや低め。ミスが増えやすい状態です。' });
  if (sentiment === 'bad')              w.push({ level: 'critical', message: '地合いが悪い。損失が拡大しやすい環境です。' });
  if (currentPrice > prevHigh)         w.push({ level: 'warning',  message: '前日高値を超えています。高値追いになる可能性があります。' });
  if (currentPrice < prevLow)          w.push({ level: 'warning',  message: '前日安値を割っています。下落トレンドの可能性があります。' });
  const vol = (prevHigh - prevLow) / prevLow * 100;
  if (vol > 5)                         w.push({ level: 'warning',  message: `ボラティリティが高い銘柄です（${vol.toFixed(1)}%）。損切り幅が大きくなります。` });
  if (volume !== null && volume > 0)   w.push({ level: 'warning',  message: '出来高は自分で平均と比較して確認してください。' });
  return w;
}


/* ============================================================
   LAYER 1b: 純粋計算関数 ── 中長期（スイング）
   ============================================================ */

/** 週足・月足トレンドスコア */
function calcTrendScore(trend) {
  return { up: 3, side: 0, down: -3 }[trend] ?? 0;
}

/** 決算日との距離スコア（近いほどリスクが高い） */
function calcEarningsScore(earningsProx) {
  return { far: 1, month: 0, twoweeks: -1, week: -3, unknown: 0 }[earningsProx] ?? 0;
}

/** セクターモメンタムスコア */
function calcSectorMomentumScore(sectorMom) {
  return { strong: 2, neutral: 0, weak: -2 }[sectorMom] ?? 0;
}

/** R/R 比（リスクリワード比）を計算 */
function calcRR(currentPrice, stopLoss, targetPrice) {
  if (!targetPrice || targetPrice <= currentPrice) return null;
  const risk   = currentPrice - stopLoss;
  const reward = targetPrice  - currentPrice;
  if (risk <= 0) return null;
  return reward / risk;
}

/** 中長期エントリーシグナル */
function calcEntrySignalMid({ totalScore, focus, earningsProx }) {
  if (focus <= 2)                                      return { signal: 'ng',    label: '触るな',       reason: '集中度が低すぎます（ハードルール）' };
  if (earningsProx === 'week' && totalScore < 5)       return { signal: 'watch', label: '様子見',       reason: '1週間以内に決算あり。ポジション縮小推奨' };
  if (totalScore >= 5)                                 return { signal: 'ok',    label: 'エントリー OK', reason: `スコア ${totalScore}：条件良好` };
  if (totalScore >= 1)                                 return { signal: 'watch', label: '様子見',       reason: `スコア ${totalScore}：条件が揃っていない` };
  return                                                      { signal: 'ng',    label: '触るな',       reason: `スコア ${totalScore}：条件が悪すぎる` };
}

/** 中長期ポジションサイズ */
function calcPositionSizeMid({ score, currentPrice, stopLoss, focus, trend, rr }) {
  const riskPercent = (currentPrice - stopLoss) / currentPrice * 100;
  const rrVal = rr ?? 0;
  if (score >= 7 && rrVal >= 2.5 && focus >= 4 && trend === 'up')
    return { size: 'large',  label: '大',    reason: `スコア${score}・R/R ${rrVal.toFixed(1)}・集中${focus}・上昇トレンドの全条件が揃いました` };
  if (score >= 5 && rrVal >= 2.0 && focus >= 3)
    return { size: 'medium', label: '中',    reason: `スコア${score}・R/R ${rrVal.toFixed(1)}・集中${focus}が条件を満たしています` };
  if (score >= 2 && rrVal >= 1.5)
    return { size: 'small',  label: '小',    reason: `R/R ${rrVal.toFixed(1)}は許容範囲ですが、条件が不十分です` };
  return   { size: 'pass',   label: '見送り', reason: `R/R ${rrVal.toFixed(1)}が低いか、条件が揃っていません` };
}

/** 中長期リスク警告 */
function calcRiskWarningsMid({ focus, trend, earningsProx, sectorMom, sentiment, rr }) {
  const w = [];
  if (focus <= 2)                       w.push({ level: 'critical', message: '集中度が低すぎます。エントリーは避けてください。' });
  else if (focus === 3)                 w.push({ level: 'warning',  message: '集中度がやや低め。ミスが増えやすい状態です。' });
  if (trend === 'down')                 w.push({ level: 'warning',  message: '下降トレンドです。逆張りエントリーはリスクが高い。' });
  if (sentiment === 'bad')              w.push({ level: 'critical', message: '地合いが悪い。損失が拡大しやすい環境です。' });
  if (earningsProx === 'week')          w.push({ level: 'critical', message: '1週間以内に決算があります。ギャップリスクが非常に高い。' });
  else if (earningsProx === 'twoweeks') w.push({ level: 'warning',  message: '2週間以内に決算があります。保有期間に注意してください。' });
  if (sectorMom === 'weak')             w.push({ level: 'warning',  message: 'セクターモメンタムが弱い。逆風環境です。' });
  if (rr !== null && rr < 1.5)         w.push({ level: 'warning',  message: `R/R比が ${rr?.toFixed(2)} と低い。十分な利確幅を確保してください。` });
  return w;
}


/* ============================================================
   LAYER 1c: 自動計算ヘルパー ── トレンド・地合い
   ============================================================ */

/**
 * 過去の終値配列（古い順）から週足・月足のトレンドを判定する
 * 日次データ（100件超）でも週次データ（26件程度）でも動作するよう
 * データ量に応じてウィンドウを自動調整する
 */
function calcTrendAuto(closes) {
  if (!closes || closes.length < 10) return null;
  const n   = closes.length;
  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  // 短期MA: データの約30%（日次なら20日、週次なら7〜8週）
  const shortW = Math.max(4, Math.min(20, Math.floor(n * 0.3)));
  // 長期MA: データ全体（日次なら60日、週次なら26週）
  const longW  = n;
  const maShort = avg(closes.slice(-shortW));
  const maLong  = avg(closes.slice(-longW));
  const cur     = closes[n - 1];
  if (cur > maShort && maShort > maLong) return 'up';
  if (cur < maShort && maShort < maLong) return 'down';
  return 'side';
}

/**
 * 指数の終値配列（古い順）から地合いを判定する
 * 5営業日前比・20営業日前比で判断
 */
function calcSentimentAuto(indexCloses) {
  if (!indexCloses || indexCloses.length < 5) return null;
  const n        = indexCloses.length;
  const cur      = indexCloses[n - 1];
  const prev5d   = indexCloses[Math.max(0, n - 6)];
  const prev20d  = indexCloses[Math.max(0, n - 21)];
  const ch5  = (cur - prev5d)  / prev5d  * 100;
  const ch20 = (cur - prev20d) / prev20d * 100;
  if (ch5 > 1.0 && ch20 > 0) return 'good';
  if (ch5 < -1.0 && ch20 < 0) return 'bad';
  return 'normal';
}


/* ============================================================
   LAYER 1c-A: 株価データ取得 ── Alpha Vantage（API キー使用時）
   ============================================================
   ブラウザから直接 HTTPS アクセス可能。プロキシ不要。
   無料プランは 25回/日。日本株は ".TYO" suffix を使用。
   ============================================================ */

/** 生ティッカーから数字コード部分だけを取り出す */
function extractCode(ticker) {
  return ticker.trim()
    .replace(/\.(T|TYO|jp|TYO)$/i, '')
    .replace(/\.us$/i, '')
    .replace(/\s.*$/, '')
    .toUpperCase();
}

/**
 * SYMBOL_SEARCH で正確な Alpha Vantage シンボルを取得し localStorage にキャッシュ。
 * 日本株: "7011" → SYMBOL_SEARCH("7011.T") → ヒットしなければ "7011.T" を直接試す
 * 米国株: "AAPL" → キャッシュ不要、コードをそのまま返す
 */
async function resolveAVSymbol(ticker, market, apiKey) {
  const code = extractCode(ticker);

  if (market === 'us') return code;  // US は suffix なし

  const cacheKey = `av_sym_${code}`;
  const cached   = localStorage.getItem(cacheKey);
  if (cached) return cached;

  // ".T" を付けて検索するとヒット率が上がる
  const searchTerm = `${code}.T`;
  const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH` +
              `&keywords=${encodeURIComponent(searchTerm)}&apikey=${encodeURIComponent(apiKey)}`;

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res  = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data['Note'] || data['Information'])
      throw new Error('[AV] API利用制限中（25回/日）。明日また試してください。');

    const matches = data['bestMatches'] ?? [];
    // region に 'japan' が含まれる、または通貨が JPY のものを選ぶ（大文字小文字不問）
    const jpMatch = matches.find(m =>
      (m['4. region'] || '').toLowerCase().includes('japan') ||
      (m['8. currency'] || '').toUpperCase() === 'JPY'
    );

    // SYMBOL_SEARCH でヒットしなくても "{code}.T" をフォールバックとして使う
    const symbol = jpMatch ? jpMatch['1. symbol'] : searchTerm;
    localStorage.setItem(cacheKey, symbol);  // キャッシュ保存
    return symbol;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('タイムアウト。再度お試しください。');
    throw e;
  } finally {
    clearTimeout(tid);
  }
}

/** TIME_SERIES_DAILY でOHLCVを取得（API 1回消費） */
async function fetchAVDailyData(symbol, apiKey) {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY` +
              `&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}&outputsize=compact`;

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res  = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data['Error Message']) {
      const avMsg = data['Error Message'];
      if (avMsg.includes('Invalid API call')) throw new Error(`[AV] 未対応シンボル（${symbol}）`);
      throw new Error(`[AV] ${avMsg}`);
    }
    // Note / Information はどちらも無料プランの利用制限超過（25回/日）を意味する
    if (data['Note'] || data['Information'])
      throw new Error('[AV] API利用制限中（25回/日）。明日また試してください。');

    const ts = data['Time Series (Daily)'];
    if (!ts) throw new Error('データが取得できませんでした');

    const dates      = Object.keys(ts).sort();   // 古い順
    const latestDate = dates[dates.length - 1];
    const row        = ts[latestDate];
    const closes     = dates.map(d => parseFloat(ts[d]['4. close'])).filter(v => !isNaN(v));
    return {
      prevHigh: parseFloat(row['2. high']),
      prevLow:  parseFloat(row['3. low']),
      volume:   parseFloat(row['5. volume']) || null,
      date:     latestDate,
      closes,
    };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('タイムアウト。再度お試しください。');
    throw e;
  } finally {
    clearTimeout(tid);
  }
}

async function fetchFromAlphaVantage(ticker, market, apiKey) {
  // ① シンボルを解決（日本株は初回のみ SYMBOL_SEARCH、以降はキャッシュ）
  const symbol = await resolveAVSymbol(ticker, market, apiKey);
  // ② 日次データを取得
  return await fetchAVDailyData(symbol, apiKey);
}


/* ============================================================
   LAYER 1c-A2: 株価データ取得 ── Twelve Data（日本株対応・CORS ネイティブ）
   ============================================================
   ブラウザから直接 HTTPS アクセス可能。プロキシ不要。
   無料プランは 800回/日・8回/分。日本株は "7011:TSE" 形式。
   ============================================================ */

async function fetchFromTwelveData(ticker, market, apiKey) {
  const code = extractCode(ticker).toUpperCase();
  const sym  = market === 'us' ? code : `${code}:TSE`;
  const url  = `https://api.twelvedata.com/time_series` +
               `?symbol=${encodeURIComponent(sym)}&interval=1day&outputsize=100` +
               `&apikey=${encodeURIComponent(apiKey)}`;

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res  = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.status === 'error') {
      const msg = (data.message || '').toLowerCase();
      if (msg.includes('not found') || msg.includes('invalid') || data.code === 400)
        throw new Error(`銘柄が見つかりません（${sym}）`);
      if (msg.includes('plan') || msg.includes('limit') || data.code === 429)
        throw new Error('[TD] API利用制限。しばらく待ってから再試行してください。');
      throw new Error(`[TD] ${data.message}`);
    }
    if (!data.values?.length) throw new Error('データなし');

    const latest = data.values[0];  // 最新（新しい順）
    const closes = data.values
      .map(v => parseFloat(v.close))
      .filter(v => !isNaN(v))
      .reverse();  // 古い順に並び替え

    return {
      prevHigh: parseFloat(latest.high),
      prevLow:  parseFloat(latest.low),
      volume:   parseFloat(latest.volume) || null,
      date:     latest.datetime,
      closes,
    };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('[TD] タイムアウト');
    throw e;
  } finally {
    clearTimeout(tid);
  }
}


/* ============================================================
   LAYER 1c-B: 株価データ取得 ── Stooq.com（API キーなし時）
   ============================================================
   ※ Yahoo Finance はブラウザからの直接アクセスを CORS で遮断し、
     プロキシ経由も認証要件により弾かれるため Stooq に変更。
   Stooq はリアルタイム価格非対応のため、取得するのは
   「前日高値・前日安値・出来高」の3項目のみ。
   現在価格はユーザーが手動入力する。
   ============================================================ */

/**
 * 入力文字列を Stooq シンボルに変換する
 * 日本株: "7011" / "7011 三菱重工" / "7011.T" → "7011.jp"
 * 米国株: "AAPL" / "aapl.us"               → "aapl.us"
 */
function toStooqSymbol(ticker, market) {
  const code = ticker.trim()
    .replace(/\.(T|JP)$/i, '')
    .replace(/\.us$/i, '')
    .replace(/\s.*$/, '')   // スペース以降（銘柄名部分）を除去
    .toLowerCase();
  return market === 'us' ? `${code}.us` : `${code}.jp`;
}

/**
 * Stooq の CSV レスポンスをパースする
 * フォーマット: Date,Open,High,Low,Close,Volume（昇順）
 * 最終行 = 直近の完結した取引日
 */
function parseStooqCSV(csvText) {
  const lines = csvText
    .replace(/^\uFEFF/, '')   // BOM 除去
    .replace(/\r/g, '')
    .trim()
    .split('\n')
    .filter(l => l.trim() !== '');

  if (lines.length < 2) throw new Error('銘柄コードを確認してください（データなし）');

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const hIdx = headers.indexOf('high');
  const lIdx = headers.indexOf('low');
  const vIdx = headers.indexOf('volume');
  const cIdx = headers.indexOf('close');

  if (hIdx < 0 || lIdx < 0) throw new Error('データ形式が想定外です');

  // 最終行 = 最新の取引日（前日高値・安値として使う）
  const last = lines[lines.length - 1].split(',');
  const prevHigh = parseFloat(last[hIdx]);
  const prevLow  = parseFloat(last[lIdx]);
  const volume   = vIdx >= 0 ? (parseFloat(last[vIdx]) || null) : null;
  const date     = last[0] ?? '';

  if (isNaN(prevHigh) || isNaN(prevLow)) throw new Error('銘柄コードを確認してください（データなし）');

  // 全日の終値（古い順）
  const closes = cIdx >= 0
    ? lines.slice(1).map(l => parseFloat(l.split(',')[cIdx])).filter(v => !isNaN(v))
    : [];

  return { prevHigh, prevLow, volume, date, closes };
}

/**
 * トレンド計算用の終値配列を取得する（プロキシ経由・非クリティカル）
 * Yahoo Finance 週足（6ヶ月）と Stooq 日次（6ヶ月）を6並列で試行
 */
async function fetchTrendData(ticker, market) {
  const code     = extractCode(ticker).toUpperCase();
  const sym      = market === 'us' ? code : `${code}.T`;
  const yhUrl    = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1wk&range=6mo`;

  // Stooq 6ヶ月日次（終値配列としてトレンド計算に使用）
  const stooqSym = market === 'us' ? `${code.toLowerCase()}.us` : `${code.toLowerCase()}.jp`;
  const d1 = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  })();
  const stooqUrl = `https://stooq.com/q/d/l/?s=${stooqSym}&d1=${d1}&i=d`;

  function parseYahoo(data) {
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const closes  = (result.indicators.quote[0].close || []).filter(c => c != null);
    if (closes.length < 10) return null;
    const longName = result.meta?.longName || result.meta?.shortName || null;
    return { closes, longName };
  }

  function parseStooq(text) {
    try {
      const parsed = parseStooqCSV(text);
      if (!parsed.closes || parsed.closes.length < 10) return null;
      return { closes: parsed.closes, longName: null };
    } catch (_) { return null; }
  }

  async function attemptJson(url, ms) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseYahoo(await res.json());
      if (!parsed) throw new Error('データなし');
      return parsed;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('タイムアウト');
      throw e;
    } finally { clearTimeout(tid); }
  }

  async function attemptCsv(url, ms) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseStooq(await res.text());
      if (!parsed) throw new Error('データなし');
      return parsed;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('タイムアウト');
      throw e;
    } finally { clearTimeout(tid); }
  }

  const p = u => encodeURIComponent(u);
  try {
    return await Promise.any([
      attemptCsv(stooqUrl,                                                 10000),  // 直接
      attemptJson(`https://corsproxy.io/?url=${p(yhUrl)}`,                 10000),
      attemptJson(`https://corsproxy.org/?url=${p(yhUrl)}`,                10000),
      attemptJson(`https://api.allorigins.win/raw?url=${p(yhUrl)}`,        10000),
      attemptJson(`https://api.codetabs.com/v1/proxy?quest=${p(yhUrl)}`,   10000),
      attemptCsv(`https://corsproxy.io/?url=${p(stooqUrl)}`,               10000),
      attemptCsv(`https://corsproxy.org/?url=${p(stooqUrl)}`,              10000),
      attemptCsv(`https://api.allorigins.win/raw?url=${p(stooqUrl)}`,      10000),
      attemptCsv(`https://api.codetabs.com/v1/proxy?quest=${p(stooqUrl)}`, 10000),
    ]);
  } catch (_) {
    return null;  // 非クリティカル：失敗しても null を返すのみ
  }
}

/**
 * 指数データを取得して地合い計算用の終値配列を返す
 * 日本株 → 日経225（^N225）、米国株 → S&P500（^GSPC）
 * 失敗しても null を返すのみ（非クリティカル）
 */
async function fetchIndexData(market) {
  const sym  = market === 'us' ? '%5EGSPC' : '%5EN225';
  const yhUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1mo`;

  function parseCloses(data) {
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const closes = (result.indicators.quote[0].close || []).filter(c => c != null);
    return closes.length > 0 ? closes : null;
  }

  async function attempt(url, ms) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const closes = parseCloses(await res.json());
      if (!closes) throw new Error('データなし');
      return closes;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('タイムアウト');
      throw e;
    } finally {
      clearTimeout(tid);
    }
  }

  const p = (u) => encodeURIComponent(u);
  try {
    return await Promise.any([
      attempt(`https://corsproxy.io/?url=${p(yhUrl)}`, 12000),
      attempt(`https://api.allorigins.win/raw?url=${p(yhUrl)}`, 12000),
      attempt(`https://api.codetabs.com/v1/proxy?quest=${p(yhUrl)}`, 12000),
    ]);
  } catch (_) {
    return null;  // 地合い自動取得は非クリティカルなので失敗しても無視
  }
}

/** 株価データを取得してトレンド・地合いを付加して返す */
async function fetchStockData(ticker, market) {
  const avKey = localStorage.getItem('av_api_key');
  const tdKey = localStorage.getItem('td_api_key');

  // ── Step 1: OHLCV 取得（クリティカル）──────────────────────────
  // TD・AV・proxy を並列実行。closes（100件）を返す TD/AV を優先。
  let stockData;
  try {
    const attempts = [fetchFromProxy(ticker, market)];
    // AV は JP・US 両対応（1日25回の上限に達した場合は失敗するが、TD/proxy が補完する）
    if (avKey) attempts.unshift(fetchFromAlphaVantage(ticker, market, avKey));
    // TD は JP・US 両対応
    if (tdKey) attempts.unshift(fetchFromTwelveData(ticker, market, tdKey));
    stockData = await Promise.any(attempts);
  } catch (e) {
    // AggregateError から最も有用なメッセージを取り出す
    const msgs = (e instanceof AggregateError)
      ? [...new Set(e.errors.map(err => err.message))]
      : [e.message];
    // 優先度: ① ユーザー向け具体エラー（銘柄不明など）
    //         ② API 内部エラー（[AV] / [TD] プレフィクス）
    //         ③ 汎用エラー
    const isGeneric  = m => m.includes('手動で');
    const isApiError = m => m.startsWith('[AV]') || m.startsWith('[TD]');
    const best =
      msgs.find(m => !isGeneric(m) && !isApiError(m)) ||
      msgs.find(m => !isGeneric(m)) ||
      msgs[0];
    throw new Error(best || 'データ取得できませんでした。手動で価格を入力してください。');
  }

  // ── Step 2: トレンド・地合い取得（非クリティカル）─────────────
  // OHLCV 確保後に投げてプロキシへの同時リクエスト競合を回避
  const [trendResult, indexResult] = await Promise.allSettled([
    (stockData.closes?.length >= 20)
      ? Promise.resolve(stockData.closes)   // AV 経路なら closes を使い回す
      : fetchTrendData(ticker, market),
    fetchIndexData(market),
  ]);

  const trendData   = trendResult.status === 'fulfilled' ? trendResult.value : null;
  const indexCloses = indexResult.status === 'fulfilled' ? indexResult.value : null;

  const trendCloses = Array.isArray(trendData) ? trendData : trendData?.closes ?? null;
  const longName    = trendData?.longName ?? null;

  const trend     = calcTrendAuto(trendCloses);
  const sentiment = calcSentimentAuto(indexCloses);

  return { ...stockData, trend, sentiment, longName };
}

async function fetchFromProxy(ticker, market) {
  const stooqSym = toStooqSymbol(ticker, market);
  const yhCode   = extractCode(ticker).toUpperCase();
  const yhSym    = market === 'us' ? yhCode : `${yhCode}.T`;

  const d1 = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);   // 直近2週で十分（プロキシ負荷を抑える）
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  })();
  const stooqUrl = `https://stooq.com/q/d/l/?s=${stooqSym}&d1=${d1}&i=d`;
  const yhUrl    = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yhSym)}?interval=1d&range=5d`;

  function parseYahoo(data) {
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('銘柄が見つかりません');
    const quotes = result.indicators.quote[0];
    const ts     = result.timestamp;
    let i = ts.length - 1;
    while (i >= 0 && (quotes.high[i] == null || quotes.low[i] == null)) i--;
    if (i < 0) throw new Error('有効なデータがありません');
    return {
      prevHigh: quotes.high[i],
      prevLow:  quotes.low[i],
      volume:   quotes.volume?.[i] || null,
      date:     new Date(ts[i] * 1000).toISOString().slice(0, 10),
      closes:   [],   // プロキシ経路では closes は空（トレンド計算はAV経路のみ）
    };
  }

  async function attempt(url, type, ms) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (type === 'csv') return parseStooqCSV(await res.text());
      return parseYahoo(await res.json());
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('タイムアウト');
      throw e;
    } finally {
      clearTimeout(tid);
    }
  }

  const p = (u) => encodeURIComponent(u);
  try {
    // Stooq 直接アクセス（CORS ヘッダーを返す場合がある）を先頭に、
    // 続いてプロキシ4本 × 2ソース（Stooq CSV + Yahoo JSON）で同時試行
    return await Promise.any([
      attempt(stooqUrl,                                                  'csv',   8000),  // 直接
      attempt(`https://corsproxy.io/?url=${p(stooqUrl)}`,               'csv',  15000),
      attempt(`https://corsproxy.org/?url=${p(stooqUrl)}`,              'csv',  15000),
      attempt(`https://api.allorigins.win/raw?url=${p(stooqUrl)}`,      'csv',  15000),
      attempt(`https://api.codetabs.com/v1/proxy?quest=${p(stooqUrl)}`, 'csv',  15000),
      attempt(`https://corsproxy.io/?url=${p(yhUrl)}`,                  'json', 15000),
      attempt(`https://corsproxy.org/?url=${p(yhUrl)}`,                 'json', 15000),
      attempt(`https://api.allorigins.win/raw?url=${p(yhUrl)}`,         'json', 15000),
      attempt(`https://api.codetabs.com/v1/proxy?quest=${p(yhUrl)}`,    'json', 15000),
    ]);
  } catch (_) {
    throw new Error('プロキシ経由の取得に失敗しました。Twelve Data APIキーを設定すると安定して取得できます。');
  }
}


/* ============================================================
   LAYER 2: オーケストレーター
   ============================================================ */

function analyzeEntry(inputs) {
  const { ticker, currentPrice, prevHigh, prevLow, volume, sentiment, focus, market } = inputs;
  const marketScore = calcMarketScore(sentiment);
  const focusScore  = calcFocusScore(focus);
  const { score: priceScore, position } = calcPricePositionScore(currentPrice, prevHigh, prevLow);
  const totalScore   = marketScore + focusScore + priceScore;
  const entrySignal  = calcEntrySignal({ totalScore, focus, sentiment });
  const stopLoss     = calcStopLoss(currentPrice, prevLow, market);
  const lossPercent  = ((currentPrice - stopLoss) / currentPrice * 100).toFixed(2);
  const positionSize = calcPositionSize({ score: totalScore, currentPrice, stopLoss, focus, sentiment });
  const warnings     = calcRiskWarningsShort({ focus, sentiment, currentPrice, prevHigh, prevLow, volume });
  return { tab: 'short', ticker, market, totalScore, scoreDetail: { marketScore, focusScore, priceScore, position }, entrySignal, stopLoss, lossPercent, positionSize, warnings, rr: null };
}

function analyzeEntryMid(inputs) {
  const { ticker, currentPrice, prevHigh, prevLow, volume, sentiment, focus, trend, earningsProx, sectorMom, targetPrice, market } = inputs;
  const trendScore   = calcTrendScore(trend);
  const earningsScore = calcEarningsScore(earningsProx);
  const sectorScore  = calcSectorMomentumScore(sectorMom);
  const marketScore  = calcMarketScore(sentiment);
  const focusScore   = calcFocusScore(focus);
  const { score: priceScore } = calcPricePositionScore(currentPrice, prevHigh, prevLow);
  const totalScore   = trendScore + earningsScore + sectorScore + marketScore + focusScore + priceScore;
  const entrySignal  = calcEntrySignalMid({ totalScore, focus, earningsProx });
  const stopLoss     = calcStopLoss(currentPrice, prevLow, market);
  const lossPercent  = ((currentPrice - stopLoss) / currentPrice * 100).toFixed(2);
  const rr           = calcRR(currentPrice, stopLoss, targetPrice);
  const positionSize = calcPositionSizeMid({ score: totalScore, currentPrice, stopLoss, focus, trend, rr });
  const warnings     = calcRiskWarningsMid({ focus, trend, earningsProx, sectorMom, sentiment, rr });
  const scoreDetail  = { trendScore, earningsScore, sectorScore, marketScore, focusScore, priceScore };
  return { tab: 'mid', ticker, market, totalScore, scoreDetail, entrySignal, stopLoss, lossPercent, positionSize, warnings, rr, targetPrice };
}


/* ============================================================
   LAYER 3: DOM レンダリング関数
   ============================================================ */

function renderJudgment(result) {
  const el = document.getElementById('judgment-box');
  el.className = `judgment-box ${result.entrySignal.signal}`;
  const companyName = document.getElementById('ticker').dataset.companyName || '';
  const nameDisplay = companyName ? ` <span class="ticker-company">${escapeHtml(companyName)}</span>` : '';
  const tickerStr   = result.ticker ? `「${escapeHtml(result.ticker)}」${nameDisplay}` : '';

  let scoreBreakdown;
  if (result.tab === 'short') {
    const d = result.scoreDetail;
    scoreBreakdown = `地合い${fmt(d.marketScore)} / 集中${fmt(d.focusScore)} / 価格${fmt(d.priceScore)}`;
  } else {
    const d = result.scoreDetail;
    scoreBreakdown = `トレンド${fmt(d.trendScore)} / 決算${fmt(d.earningsScore)} / セクター${fmt(d.sectorScore)} / 地合い${fmt(d.marketScore)} / 集中${fmt(d.focusScore)} / 価格${fmt(d.priceScore)}`;
  }

  el.innerHTML = `
    <div class="judgment-ticker">${tickerStr}</div>
    <span class="judgment-label">${escapeHtml(result.entrySignal.label)}</span>
    <div class="judgment-score">スコア: ${result.totalScore}（${scoreBreakdown}）</div>
    <div style="margin-top:0.5rem; font-size:0.8125rem; color:var(--text-secondary)">${escapeHtml(result.entrySignal.reason)}</div>
  `;
}

function renderWarnings(warnings) {
  const container = document.getElementById('warnings-container');
  const section   = document.getElementById('warnings-section');
  if (warnings.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  const icons = { critical: '⛔', warning: '⚠️' };
  container.innerHTML = warnings.map(w =>
    `<li class="warning-item ${w.level}"><span class="warning-icon">${icons[w.level]}</span><span>${escapeHtml(w.message)}</span></li>`
  ).join('');
}

function renderStopLoss(stopLoss, lossPercent, market) {
  const symbol    = market === 'us' ? '$' : '¥';
  const formatted = market === 'us' ? stopLoss.toFixed(2) : stopLoss.toLocaleString();
  document.getElementById('stop-loss-value').textContent = `${symbol}${formatted}`;
  document.getElementById('stop-loss-sub').textContent   = `（現在価格から -${lossPercent}%）`;
}

function renderRR(rr) {
  const row = document.getElementById('rr-row');
  if (rr === null) { row.style.display = 'none'; return; }
  row.style.display = 'flex';
  const rrVal  = document.getElementById('rr-value');
  const rrSub  = document.getElementById('rr-sub');
  let cls, label;
  if (rr >= 2.5)       { cls = 'rr-good'; label = '非常に良好'; }
  else if (rr >= 2.0)  { cls = 'rr-good'; label = '良好'; }
  else if (rr >= 1.5)  { cls = 'rr-ok';   label = '許容範囲'; }
  else                 { cls = 'rr-bad';   label = '不十分'; }
  rrVal.textContent = rr.toFixed(2);
  rrVal.className   = cls;
  rrSub.textContent = `（${label}）`;
}

function renderPositionSize(positionSize) {
  const badge = document.getElementById('position-badge');
  badge.textContent = positionSize.label;
  badge.className   = `position-badge ${positionSize.size}`;
  document.getElementById('position-reason').textContent = positionSize.reason;
}

function showResults(result) {
  renderJudgment(result);
  renderWarnings(result.warnings);
  renderStopLoss(result.stopLoss, result.lossPercent, result.market);
  renderRR(result.rr);
  renderPositionSize(result.positionSize);

  // 結果に紐付けたデータを AI クエリ生成用に保存
  document.getElementById('ai-query-box').style.display = 'none';
  document.getElementById('ai-btn').dataset.result = JSON.stringify({
    ticker:      result.ticker,
    currentPrice: null, // form値をAI queryで使う
    tab:         result.tab,
    signal:      result.entrySignal.label,
    score:       result.totalScore,
  });

  document.getElementById('form-section').style.display   = 'none';
  document.getElementById('result-section').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetToForm() {
  document.getElementById('form-section').style.display   = 'block';
  document.getElementById('result-section').style.display = 'none';
  document.getElementById('ai-query-box').style.display   = 'none';
}

function setFetchStatus(type, message) {
  const el = document.getElementById('fetch-status');
  el.textContent = message;
  el.className   = `fetch-status ${type}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 数値を +/-付き文字列に変換 */
function fmt(n) { return (n > 0 ? '+' : '') + n; }

/** AI クエリ文字列を生成 */
function buildAiQuery(ticker, tab, currentPrice, stopLoss, targetPrice, score, signal) {
  const t = ticker || '（銘柄未入力）';
  const base = `【${t}】について以下を教えてください。

■ 決算・業績
・次の決算発表日はいつですか？
・直近の業績トレンド（売上・利益の方向性）はどうですか？

■ 株価モメンタム
・直近3〜6ヶ月の株価動向はどうですか？
・52週高値・安値と現在値（${currentPrice ? `${currentPrice}円/ドル` : '未入力'}）を踏まえてどう評価しますか？

■ セクター・競合
・所属セクターの現在の強弱はどうですか？
・主要競合と比べてモメンタムの差はありますか？`;

  const midExtra = tab === 'mid' && targetPrice
    ? `\n\n■ 目標・リスク参考\n・現在価格付近からの目標 ${targetPrice} に対してテクニカル的な根拠はありますか？`
    : '';

  const footer = `\n\n[参考: このツールの現時点スコア ${score}、判定「${signal}」]`;
  return base + midExtra + footer;
}


/* ============================================================
   LAYER 4: イベントリスナー
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  let currentMarket = 'jp';
  let currentTab    = 'short';

  // ── API キー共通ヘルパー ──
  function makeKeyUI(prefix, storageKey, label) {
    function update() {
      const has = !!localStorage.getItem(storageKey);
      document.getElementById(`${prefix}-no-key`).style.display  = has ? 'none' : '';
      document.getElementById(`${prefix}-has-key`).style.display = has ? '' : 'none';
    }
    document.getElementById(`${prefix}-toggle`).addEventListener('click', () => {
      const f = document.getElementById(`${prefix}-form`);
      f.style.display = f.style.display === 'none' ? '' : 'none';
    });
    document.getElementById(`${prefix}-key-save`).addEventListener('click', () => {
      const key = document.getElementById(`${prefix}-key-input`).value.trim();
      if (!key) return;
      localStorage.setItem(storageKey, key);
      update();
      document.getElementById(`${prefix}-form`).style.display = 'none';
      setFetchStatus('success', `${label} APIキーを保存しました。`);
    });
    document.getElementById(`${prefix}-key-clear`).addEventListener('click', () => {
      localStorage.removeItem(storageKey);
      update();
      setFetchStatus('', '');
    });
    update();
  }

  makeKeyUI('td', 'td_api_key', 'Twelve Data');
  makeKeyUI('av', 'av_api_key', 'Alpha Vantage');

  // ── 市場セレクター ──
  document.querySelectorAll('.market-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentMarket = btn.dataset.market;
      document.querySelectorAll('.market-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const step = currentMarket === 'us' ? '0.01' : '1';
      ['currentPrice', 'prevHigh', 'prevLow'].forEach(id => {
        const el = document.getElementById(id);
        el.step  = step;
        el.value = '';
      });
      document.getElementById('volume').value  = '';
      document.getElementById('ticker').value  = '';
      setFetchStatus('', '');
    });
  });

  // ── 取引タイプ タブ ──
  document.querySelectorAll('.time-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      document.querySelectorAll('.time-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const isShort = currentTab === 'short';
      document.getElementById('fields-short').style.display = isShort ? '' : 'none';
      document.getElementById('fields-mid').style.display   = isShort ? 'none' : '';

      // 価格ラベルの補足テキストを切り替え
      document.getElementById('price-label-note').textContent = isShort
        ? '前日の高値・安値を入力'
        : '直近のスイング高値・安値を入力';
      document.getElementById('label-prevHigh').textContent = isShort ? '前日高値' : '直近高値';
      document.getElementById('label-prevLow').textContent  = isShort ? '前日安値' : '直近安値';
    });
  });

  // ── スライダー（短期） ──
  const sliderShort = document.getElementById('focus-short');
  const sliderShortVal = document.getElementById('focus-short-value');
  sliderShort.addEventListener('input', () => { sliderShortVal.textContent = sliderShort.value; });

  // ── スライダー（中長期） ──
  const sliderMid = document.getElementById('focus-mid');
  const sliderMidVal = document.getElementById('focus-mid-value');
  sliderMid.addEventListener('input', () => { sliderMidVal.textContent = sliderMid.value; });

  // ── 自動取得ボタン ──
  const fetchBtn = document.getElementById('fetch-btn');
  fetchBtn.addEventListener('click', async () => {
    try {
      const ticker = document.getElementById('ticker').value;
      if (!ticker.trim()) { setFetchStatus('error', '銘柄コードを入力してください（例: 7203 または AAPL）'); return; }

      fetchBtn.disabled = true;
      setFetchStatus('loading', `${ticker.trim()} の前日データを取得中...`);

      const d = await fetchStockData(ticker, currentMarket);
      document.getElementById('prevHigh').value = d.prevHigh;
      document.getElementById('prevLow').value  = d.prevLow;
      if (d.volume) document.getElementById('volume').value = d.volume;

      // 銘柄名をキャッシュ（結果画面で表示するため）
      const tickerEl = document.getElementById('ticker');
      if (d.longName) tickerEl.dataset.companyName = d.longName;
      else            delete tickerEl.dataset.companyName;

      // トレンド自動セット（中長期タブ）
      if (d.trend) {
        document.getElementById('trend').value = d.trend;
      }
      // 地合い自動セット（短期・中長期両方）
      if (d.sentiment) {
        document.getElementById('sentiment-short').value = d.sentiment;
        document.getElementById('sentiment-mid').value   = d.sentiment;
      }

      // 現在価格の入力欄にフォーカス
      document.getElementById('currentPrice').focus();

      const dateStr  = d.date ? `（${d.date}）` : '';
      const trendLbl = { up: '上昇↑', side: '横ばい→', down: '下降↓' };
      const sentLbl  = { good: '良い', normal: '普通', bad: '悪い' };
      const trendNote = d.trend     ? `トレンド:${trendLbl[d.trend]}` : 'トレンド:-';
      const sentNote  = d.sentiment ? `地合い:${sentLbl[d.sentiment]}` : '地合い:-';
      setFetchStatus('success',
        `前日データ取得完了 ${dateStr}［${trendNote} / ${sentNote}］― 現在価格を入力してください`);
    } catch (err) {
      setFetchStatus('error', `取得失敗: ${err.message || '不明なエラー'}`);
    } finally {
      fetchBtn.disabled = false;
    }
  });

  // ── フォーム送信 ──
  document.getElementById('analysis-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;

    const ticker       = form.ticker.value.trim();
    const currentPrice = parseFloat(form.currentPrice.value);
    const prevHigh     = parseFloat(form.prevHigh.value);
    const prevLow      = parseFloat(form.prevLow.value);
    const volume       = form.volume.value !== '' ? parseFloat(form.volume.value) : null;

    if (isNaN(currentPrice) || isNaN(prevHigh) || isNaN(prevLow)) { alert('価格を正しく入力してください。'); return; }
    if (prevLow <= 0 || prevHigh <= 0 || currentPrice <= 0)         { alert('価格は正の値を入力してください。'); return; }
    if (prevHigh < prevLow)                                          { alert('前日高値は前日安値より大きい値を入力してください。'); return; }

    let result;
    if (currentTab === 'short') {
      const sentiment = document.getElementById('sentiment-short').value;
      const focus     = parseInt(sliderShort.value, 10);
      result = analyzeEntry({ ticker, currentPrice, prevHigh, prevLow, volume, sentiment, focus, market: currentMarket });
    } else {
      const trend       = form.trend.value;
      const earningsProx = form.earningsProx.value;
      const sectorMom   = form.sectorMom.value;
      const sentiment   = document.getElementById('sentiment-mid').value;
      const focus       = parseInt(sliderMid.value, 10);
      const targetPrice = form.targetPrice.value !== '' ? parseFloat(form.targetPrice.value) : null;
      result = analyzeEntryMid({ ticker, currentPrice, prevHigh, prevLow, volume, sentiment, focus, trend, earningsProx, sectorMom, targetPrice, market: currentMarket });
    }

    // AI クエリ生成用にフォーム値を保存
    document.getElementById('ai-btn').dataset.ticker      = ticker;
    document.getElementById('ai-btn').dataset.tab         = currentTab;
    document.getElementById('ai-btn').dataset.price       = currentPrice;
    document.getElementById('ai-btn').dataset.stoploss    = result.stopLoss;
    document.getElementById('ai-btn').dataset.target      = form.targetPrice?.value || '';
    document.getElementById('ai-btn').dataset.score       = result.totalScore;
    document.getElementById('ai-btn').dataset.signal      = result.entrySignal.label;

    showResults(result);
  });

  // ── Claude に調査依頼ボタン ──
  document.getElementById('ai-btn').addEventListener('click', () => {
    const btn      = document.getElementById('ai-btn');
    const ticker   = btn.dataset.ticker || '';
    const tab      = btn.dataset.tab || 'short';
    const price    = btn.dataset.price || '';
    const stopLoss = btn.dataset.stoploss || '';
    const target   = btn.dataset.target   ? parseFloat(btn.dataset.target) : null;
    const score    = btn.dataset.score    || '?';
    const signal   = btn.dataset.signal   || '?';

    const query = buildAiQuery(ticker, tab, price, stopLoss, target, score, signal);

    const box = document.getElementById('ai-query-box');
    document.getElementById('ai-query-text').textContent = query;
    box.style.display = 'block';
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ── クリップボードコピー & Claude.ai を開く ──
  document.getElementById('ai-copy-btn').addEventListener('click', async () => {
    const text = document.getElementById('ai-query-text').textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // フォールバック: テキストエリア経由
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    window.open('https://claude.ai', '_blank', 'noopener');
    document.getElementById('ai-copy-btn').textContent = 'コピー済み！Claude.ai が開きました';
    setTimeout(() => {
      document.getElementById('ai-copy-btn').textContent = 'クリップボードにコピー & Claude.ai を開く';
    }, 3000);
  });

  // ── リセットボタン ──
  document.getElementById('reset-btn').addEventListener('click', () => {
    resetToForm();
    document.getElementById('analysis-form').reset();
    sliderShortVal.textContent = '3';
    sliderMidVal.textContent   = '3';
    setFetchStatus('', '');
  });
});
