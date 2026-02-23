/**
 * デイトレ判断補助ツール - ロジック & DOM 操作
 *
 * ─── なぜ3ファイルに分けるか ───────────────────────────────────
 * index.html → 「何を表示するか」の骨格（構造）
 * style.css  → 「どう見せるか」の見た目（デザイン）
 * app.js     → 「どう動くか」の頭脳（ロジック）
 *
 * 3つに分けることで、デザインだけ変えたいとき・ロジックだけ
 * 直したいときに、他のファイルを触らずに済む。
 * ──────────────────────────────────────────────────────────────
 */

'use strict';

/* ============================================================
   LAYER 1: 純粋計算関数（DOM を一切触らない）
   ============================================================

   スコアシステムの「3人のアドバイザー」比喩：
   - アドバイザーA（地合い）: 「市場全体の流れ」を見る人
   - アドバイザーB（集中度）: 「あなた自身のコンディション」を見る人
   - アドバイザーC（価格位置）: 「今の価格が割安か割高か」を見る人
   3人の意見を足し算して、総合的な入力可否を判断する。
*/

/**
 * 地合いスコアを返す
 * 地合いは「川の流れ」。上流（良い）に乗れば楽、逆流（悪い）は危険。
 * @param {string} sentiment - "good" | "normal" | "bad"
 * @returns {number}
 */
function calcMarketScore(sentiment) {
  const map = { good: 2, normal: 0, bad: -2 };
  return map[sentiment] ?? 0;
}

/**
 * 集中度スコアを返す
 * 集中度は「自分のパフォーマンス係数」。低いと判断ミスが増える。
 * @param {number} focus - 1〜5
 * @returns {number}
 */
function calcFocusScore(focus) {
  const map = { 1: -2, 2: -1, 3: 0, 4: 1, 5: 2 };
  return map[focus] ?? 0;
}

/**
 * 価格位置スコアを返す
 * 価格が「どこにいるか」で優位性が変わる。
 * サポート（支持線）付近は反発しやすく有利、レジスタンス（抵抗線）
 * 付近は売り圧力が強くなりやすく不利。
 *
 * @param {number} currentPrice - 現在価格
 * @param {number} prevHigh     - 前日高値
 * @param {number} prevLow      - 前日安値
 * @returns {{ score: number, position: string }}
 */
function calcPricePositionScore(currentPrice, prevHigh, prevLow) {
  if (currentPrice > prevHigh) {
    // 前日高値超え：高値追いリスク
    return { score: -2, position: 'above_high' };
  }
  if (currentPrice < prevLow) {
    // 前日安値割れ：下落トレンドの可能性
    return { score: -3, position: 'below_low' };
  }

  const nearSupport  = prevLow * 1.01;  // 前日安値〜+1%
  const nearResist   = prevHigh * 0.99; // 前日高値-1%〜

  if (currentPrice <= nearSupport) {
    // サポート付近：反発期待で有利
    return { score: 1, position: 'near_support' };
  }
  if (currentPrice >= nearResist) {
    // レジスタンス付近：売り圧増で不利
    return { score: -1, position: 'near_resistance' };
  }

  // レンジ内：ニュートラル
  return { score: 0, position: 'range' };
}

/**
 * 損切り目安価格を返す
 *
 * 損切りロジックの根拠：
 * - 現在価格が前日安値より上：前日安値の少し下（-0.5%）を損切りラインにする。
 *   「昨日は誰かがここで買った」という実績があるため、そこを割ったら
 *   トレンドが変わったと判断できる。
 * - 現在価格が前日安値以下：すでに安値を割り込んでいるので、
 *   現在価格からさらに-2%を損切りラインとする（損失を限定するため）。
 *
 * @param {number} currentPrice
 * @param {number} prevLow
 * @returns {number}
 */
function calcStopLoss(currentPrice, prevLow, market) {
  // 日本株: 整数（円）/ 米国株: 小数2桁（ドル）
  const round = market === 'us'
    ? (v) => Math.round(v * 100) / 100
    : (v) => Math.floor(v);

  if (currentPrice > prevLow) {
    return round(prevLow * 0.995);
  }
  return round(currentPrice * 0.98);
}

/**
 * リスク警告リストを返す
 * 複数の警告が同時に発火することがある（OR 条件）
 *
 * @param {object} p
 * @param {number} p.focus
 * @param {string} p.sentiment
 * @param {number} p.currentPrice
 * @param {number} p.prevHigh
 * @param {number} p.prevLow
 * @param {number|null} p.volume  - 任意入力
 * @returns {Array<{level: 'critical'|'warning', message: string}>}
 */
function calcRiskWarnings({ focus, sentiment, currentPrice, prevHigh, prevLow, volume }) {
  const warnings = [];

  // 集中度チェック
  if (focus <= 2) {
    warnings.push({ level: 'critical', message: '集中度が低すぎます。今日の取引は避けてください。' });
  } else if (focus === 3) {
    warnings.push({ level: 'warning', message: '集中度がやや低め。ミスが増えやすい状態です。' });
  }

  // 地合いチェック
  if (sentiment === 'bad') {
    warnings.push({ level: 'critical', message: '地合いが悪い。損失が拡大しやすい環境です。' });
  }

  // 価格位置チェック
  if (currentPrice > prevHigh) {
    warnings.push({ level: 'warning', message: '前日高値を超えています。高値追いになる可能性があります。' });
  }
  if (currentPrice < prevLow) {
    warnings.push({ level: 'warning', message: '前日安値を割っています。下落トレンドの可能性があります。' });
  }

  // ボラティリティチェック（前日の値幅 ÷ 前日安値）
  const volatility = ((prevHigh - prevLow) / prevLow) * 100;
  if (volatility > 5) {
    warnings.push({
      level: 'warning',
      message: `ボラティリティが高い銘柄です（${volatility.toFixed(1)}%）。損切り幅が大きくなります。`
    });
  }

  // 出来高チェック（入力がある場合に注意喚起）
  if (volume !== null && volume > 0) {
    warnings.push({
      level: 'warning',
      message: '出来高は自分で平均と比較して確認してください（このツールは平均出来高を持っていません）。'
    });
  }

  return warnings;
}

/**
 * エントリーシグナルを返す（ハードルール優先）
 *
 * @param {object} p
 * @param {number} p.totalScore
 * @param {number} p.focus
 * @param {string} p.sentiment
 * @returns {{ signal: 'ok'|'watch'|'ng', label: string, reason: string }}
 */
function calcEntrySignal({ totalScore, focus, sentiment }) {
  // ──── ハードルール（スコアより優先） ────
  if (focus <= 2) {
    return { signal: 'ng', label: '触るな', reason: '集中度が低すぎます（ハードルール）' };
  }
  if (sentiment === 'bad' && focus < 4) {
    return { signal: 'ng', label: '触るな', reason: '地合い悪＋集中度不足（ハードルール）' };
  }

  // ──── スコア判定 ────
  if (totalScore >= 3) {
    return { signal: 'ok', label: 'エントリー OK', reason: `スコア ${totalScore}：条件良好` };
  }
  if (totalScore >= 0) {
    return { signal: 'watch', label: '様子見', reason: `スコア ${totalScore}：条件が揃っていない` };
  }
  return { signal: 'ng', label: '触るな', reason: `スコア ${totalScore}：条件が悪すぎる` };
}

/**
 * 推奨ポジションサイズを返す
 *
 * AND 条件の意味：
 * ポジションサイズは「シグナル強度 × リスク量 × コンディション」の
 * 掛け算で決まる。どれか1つが欠けても大きく張るべきでない。
 * すべての条件が揃って初めて「大」になる設計。
 *
 * @param {object} p
 * @param {number} p.score
 * @param {number} p.currentPrice
 * @param {number} p.stopLoss
 * @param {number} p.focus
 * @param {string} p.sentiment
 * @returns {{ size: 'large'|'medium'|'small'|'pass', label: string, reason: string }}
 */
function calcPositionSize({ score, currentPrice, stopLoss, focus, sentiment }) {
  const riskPercent = ((currentPrice - stopLoss) / currentPrice) * 100;

  // 大: すべての条件が揃ったとき
  if (score >= 4 && riskPercent <= 2 && focus >= 4 && sentiment === 'good') {
    return {
      size: 'large', label: '大',
      reason: `スコア${score}・リスク${riskPercent.toFixed(1)}%・集中度${focus}・地合い良の4条件が揃いました`
    };
  }
  // 中: 最低限の条件が揃ったとき
  if (score >= 2 && riskPercent <= 3 && focus >= 3) {
    return {
      size: 'medium', label: '中',
      reason: `スコア${score}・リスク${riskPercent.toFixed(1)}%・集中度${focus}が条件を満たしています`
    };
  }
  // 小: リスクが許容範囲内
  if (score >= 0 && riskPercent <= 5) {
    return {
      size: 'small', label: '小',
      reason: `リスク${riskPercent.toFixed(1)}%は許容範囲ですが、条件が不十分です`
    };
  }
  // 見送り
  return {
    size: 'pass', label: '見送り',
    reason: `リスク${riskPercent.toFixed(1)}%が大きすぎるか、条件が揃っていません`
  };
}


/* ============================================================
   LAYER 1b: 株価データ自動取得（Yahoo Finance 非公式 API）
   ============================================================ */

/**
 * 入力文字列を Yahoo Finance シンボルに変換する
 * - "7203" / "7203 トヨタ" → "7203.T"（東証）
 * - "AAPL" / "TSLA"       → "AAPL"（米国株）
 * - "7203.T" のようにすでに suffix があればそのまま使う
 */
function parseTickerToSymbol(ticker, market) {
  const t = ticker.trim();

  // 既に suffix 付き（例: 7203.T, 6758.T）
  if (/\.\w{1,3}$/.test(t)) {
    return t.toUpperCase();
  }

  // 日本株モード: 4桁数字 → .T suffix を付ける
  if (market !== 'us') {
    const jpMatch = t.match(/\b(\d{4})\b/);
    if (jpMatch) return jpMatch[1] + '.T';
  }

  // 米国株モード or その他: スペース除去して大文字化
  return t.replace(/\s+/g, '').toUpperCase();
}

/**
 * Yahoo Finance 非公式 API から株価データを取得する
 *
 * 取得内容:
 *   - 現在価格  : meta.regularMarketPrice（リアルタイム）
 *   - 前日高値  : 直近完結セッションの高値（interval=1d の最終バー）
 *   - 前日安値  : 同安値
 *   - 出来高    : meta.regularMarketVolume（本日分）
 *
 * ⚠ Yahoo Finance は非公式 API のため、ブラウザの CORS ポリシーで
 *   ブロックされる場合があります。その場合は手動入力に切り替えてください。
 */
async function fetchStockData(symbol) {
  const targetUrl =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`;

  // CORS プロキシを複数用意し、順番に試す
  // ※ URL は encodeURIComponent で渡す（プロキシの ?url= 形式に対応）
  const proxyList = [
    'https://corsproxy.io/?url=' + encodeURIComponent(targetUrl),
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(targetUrl),
  ];

  let lastError = new Error('全プロキシで取得失敗しました');

  for (const url of proxyList) {
    try {
      // AbortSignal.timeout が使えないブラウザ対応（Safari 15 以前など）
      const controller = new AbortController();
      const timerId    = setTimeout(() => controller.abort(), 8000);

      let response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timerId);
      }

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue; // 次のプロキシへ
      }

      const data   = await response.json();
      const result = data?.chart?.result?.[0];

      if (!result) {
        lastError = new Error(data?.chart?.error?.description || '銘柄が見つかりませんでした');
        continue;
      }

      const meta   = result.meta;
      const quotes = result.indicators.quote[0];
      const highs  = quotes.high || [];
      const lows   = quotes.low  || [];
      const lastIdx = highs.length - 1;

      if (lastIdx < 0) { lastError = new Error('価格データがありません'); continue; }

      const currentPrice = meta.regularMarketPrice;
      const prevHigh     = highs[lastIdx];
      const prevLow      = lows[lastIdx];
      const volume       = meta.regularMarketVolume || null;

      if (!currentPrice || !prevHigh || !prevLow) {
        lastError = new Error('価格データが不完全です'); continue;
      }

      return { currentPrice, prevHigh, prevLow, volume }; // 成功

    } catch (err) {
      lastError = err.name === 'AbortError'
        ? new Error('タイムアウトしました。再度お試しください。')
        : err;
      // 次のプロキシへ
    }
  }

  throw lastError;
}


/* ============================================================
   LAYER 2: オーケストレーター
   全計算を呼び出して結果オブジェクトを返す
   ============================================================ */

/**
 * 分析メイン関数
 * DevTools で `analyzeEntry({...})` と呼ぶことでロジック検証ができる
 *
 * @param {object} inputs
 * @param {string} inputs.ticker      - 銘柄名
 * @param {number} inputs.currentPrice
 * @param {number} inputs.prevHigh
 * @param {number} inputs.prevLow
 * @param {number|null} inputs.volume
 * @param {string} inputs.sentiment   - "good" | "normal" | "bad"
 * @param {number} inputs.focus       - 1〜5
 * @returns {object} result
 */
function analyzeEntry(inputs) {
  const { ticker, currentPrice, prevHigh, prevLow, volume, sentiment, focus, market } = inputs;

  // スコア計算
  const marketScore = calcMarketScore(sentiment);
  const focusScore  = calcFocusScore(focus);
  const { score: priceScore, position } = calcPricePositionScore(currentPrice, prevHigh, prevLow);
  const totalScore = marketScore + focusScore + priceScore;

  // 各結果
  const entrySignal  = calcEntrySignal({ totalScore, focus, sentiment });
  const stopLoss     = calcStopLoss(currentPrice, prevLow, market);
  const lossPercent  = ((currentPrice - stopLoss) / currentPrice * 100).toFixed(2);
  const positionSize = calcPositionSize({ score: totalScore, currentPrice, stopLoss, focus, sentiment });
  const warnings     = calcRiskWarnings({ focus, sentiment, currentPrice, prevHigh, prevLow, volume });

  return {
    ticker,
    market,
    totalScore,
    scoreDetail: { marketScore, focusScore, priceScore, position },
    entrySignal,
    stopLoss,
    lossPercent,
    positionSize,
    warnings
  };
}


/* ============================================================
   LAYER 3: DOM レンダリング関数
   ============================================================ */

/** 判定ボックスを描画 */
function renderJudgment(result) {
  const el = document.getElementById('judgment-box');
  el.className = `judgment-box ${result.entrySignal.signal}`;

  const tickerStr = result.ticker ? `「${result.ticker}」` : '';
  el.innerHTML = `
    <div class="judgment-ticker">${escapeHtml(tickerStr)}</div>
    <span class="judgment-label">${escapeHtml(result.entrySignal.label)}</span>
    <div class="judgment-score">スコア: ${result.totalScore}（地合い${result.scoreDetail.marketScore > 0 ? '+' : ''}${result.scoreDetail.marketScore} / 集中${result.scoreDetail.focusScore > 0 ? '+' : ''}${result.scoreDetail.focusScore} / 価格${result.scoreDetail.priceScore > 0 ? '+' : ''}${result.scoreDetail.priceScore}）</div>
    <div style="margin-top:0.5rem; font-size:0.8125rem; color:var(--text-secondary)">${escapeHtml(result.entrySignal.reason)}</div>
  `;
}

/** リスク警告リストを描画 */
function renderWarnings(warnings) {
  const container = document.getElementById('warnings-container');
  const section   = document.getElementById('warnings-section');

  if (warnings.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  const icons = { critical: '⛔', warning: '⚠️' };

  container.innerHTML = warnings.map(w => `
    <li class="warning-item ${w.level}">
      <span class="warning-icon">${icons[w.level]}</span>
      <span>${escapeHtml(w.message)}</span>
    </li>
  `).join('');
}

/** 損切り目安を描画 */
function renderStopLoss(stopLoss, lossPercent, market) {
  const symbol    = market === 'us' ? '$' : '¥';
  const formatted = market === 'us' ? stopLoss.toFixed(2) : stopLoss.toLocaleString();
  document.getElementById('stop-loss-value').textContent = `${symbol}${formatted}`;
  document.getElementById('stop-loss-sub').textContent   = `（現在価格から -${lossPercent}%）`;
}

/** 推奨ポジションサイズを描画 */
function renderPositionSize(positionSize) {
  const badge = document.getElementById('position-badge');
  badge.textContent = positionSize.label;
  badge.className   = `position-badge ${positionSize.size}`;

  document.getElementById('position-reason').textContent = positionSize.reason;
}

/** 結果セクションを表示、フォームを隠す */
function showResults(result) {
  renderJudgment(result);
  renderWarnings(result.warnings);
  renderStopLoss(result.stopLoss, result.lossPercent, result.market);
  renderPositionSize(result.positionSize);

  document.getElementById('form-section').style.display  = 'none';
  document.getElementById('result-section').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** フォームに戻す */
function resetToForm() {
  document.getElementById('form-section').style.display  = 'block';
  document.getElementById('result-section').style.display = 'none';
}

/** フェッチステータスメッセージを更新 */
function setFetchStatus(type, message) {
  const el = document.getElementById('fetch-status');
  el.textContent = message;
  el.className   = `fetch-status ${type}`;
}

/** XSS 対策用 HTML エスケープ */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


/* ============================================================
   LAYER 4: イベントリスナー
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  // 現在選択中の市場（'jp' or 'us'）
  let currentMarket = 'jp';

  // ── 市場セレクター ──
  document.querySelectorAll('.market-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentMarket = btn.dataset.market;

      // アクティブ表示切り替え
      document.querySelectorAll('.market-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // 価格入力の step を切り替え（US は小数 2 桁）
      const step = currentMarket === 'us' ? '0.01' : '1';
      ['currentPrice', 'prevHigh', 'prevLow'].forEach(id => {
        const el = document.getElementById(id);
        el.step  = step;
        el.value = '';
      });
      document.getElementById('volume').value = '';
      document.getElementById('ticker').value = '';
      setFetchStatus('', '');
    });
  });

  // ── スライダーのリアルタイム数値表示 ──
  const focusSlider = document.getElementById('focus');
  const focusValue  = document.getElementById('focus-value');

  focusSlider.addEventListener('input', () => {
    focusValue.textContent = focusSlider.value;
  });

  // ── 自動取得ボタン ──
  const fetchBtn = document.getElementById('fetch-btn');
  fetchBtn.addEventListener('click', async () => {
    // 全体を try/catch で包み、予期しないエラーも必ず画面に表示する
    try {
      const ticker = document.getElementById('ticker').value;

      if (!ticker.trim()) {
        setFetchStatus('error', '銘柄コードを入力してください（例: 7203 または AAPL）');
        return;
      }

      const symbol = parseTickerToSymbol(ticker, currentMarket);
      fetchBtn.disabled = true;
      setFetchStatus('loading', `${symbol} のデータを取得中...`);

      const d = await fetchStockData(symbol);

      document.getElementById('currentPrice').value = d.currentPrice;
      document.getElementById('prevHigh').value     = d.prevHigh;
      document.getElementById('prevLow').value      = d.prevLow;
      if (d.volume) document.getElementById('volume').value = d.volume;

      setFetchStatus('success', `取得完了（${symbol}）― 数値は必ず目視確認してください`);
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

    // 入力値取得
    const ticker       = form.ticker.value.trim();
    const currentPrice = parseFloat(form.currentPrice.value);
    const prevHigh     = parseFloat(form.prevHigh.value);
    const prevLow      = parseFloat(form.prevLow.value);
    const volumeRaw    = form.volume.value;
    const volume       = volumeRaw !== '' ? parseFloat(volumeRaw) : null;
    const sentiment    = form.sentiment.value;
    const focus        = parseInt(form.focus.value, 10);

    // 簡易バリデーション
    if (isNaN(currentPrice) || isNaN(prevHigh) || isNaN(prevLow)) {
      alert('価格を正しく入力してください。');
      return;
    }
    if (prevLow <= 0 || prevHigh <= 0 || currentPrice <= 0) {
      alert('価格は正の値を入力してください。');
      return;
    }
    if (prevHigh < prevLow) {
      alert('前日高値は前日安値より大きい値を入力してください。');
      return;
    }

    // 分析実行
    const result = analyzeEntry({ ticker, currentPrice, prevHigh, prevLow, volume, sentiment, focus, market: currentMarket });

    // 結果表示
    showResults(result);
  });

  // ── リセットボタン ──
  document.getElementById('reset-btn').addEventListener('click', () => {
    resetToForm();
    document.getElementById('analysis-form').reset();
    focusValue.textContent = '3';
    setFetchStatus('', '');
  });
});
