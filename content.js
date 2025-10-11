//content.js
const isBinanceDomain = /\.?binance\.com$/i.test(location.hostname);
const isAlphaTokenPath = /^\/[^/]+\/alpha\/[^/]+\/[^/]+(?:\/|$)/.test(location.pathname);

if (!(location.protocol.startsWith('http') && isBinanceDomain && isAlphaTokenPath)) {
  console.log("[AutoAlpha] Not a binance alpha token page — script inert.", {
    protocol: location.protocol,
    hostname: location.hostname,
    pathname: location.pathname
  });
} else {
  // ---------- State ----------
  const STATE = {
    autoLimitTotalSell: false,
    totalOffset: 0,
    autoBuyOffset: false,
    buyOffset: 1,
    autoSellOffset: false,
    sellOffset: 1,
    autoConfirm: false,
    autoMinField: false,
    minFieldValue: ""
  };

  let STOPPED = false;

  function originKey() { return location.origin; }

  function applySavedState(s) {
    if (STOPPED) return; 

    STATE.autoLimitTotalSell = !!s.autoLimitTotalSell;
    STATE.totalOffset = Number(s?.totalOffset ?? 0) || 0;

    STATE.autoBuyOffset = !!s.autoBuyOffset;
    STATE.buyOffset = Number(s?.buyOffset || 1) || 1;

    STATE.autoSellOffset = !!s.autoSellOffset;
    STATE.sellOffset = Number(s?.sellOffset || 1) || 1;

    STATE.autoConfirm = !!s.autoConfirm;
    STATE.autoMinField = !!s?.autoMinField;
    STATE.minFieldValue = s?.minFieldValue || "";

    // (Re)start theo flags
    startSell(); // limitTotal có thể chạy độc lập
    STATE.autoConfirm ? startActionClick() : stopActionClick();
    STATE.autoMinField ? startMin() : stopMin();

    if (STATE.autoBuyOffset || STATE.autoSellOffset) {
      startPriceWatcher();
    } else {
      stopPriceWatcher();
    }
  }

  function loadStateForOrigin() {
    chrome.storage.local.get([originKey()], (res) => {
      const st = res[originKey()];
      if (!st) return; 
      applySavedState(st || {});
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const key = originKey();
    if (!changes[key]) return;
    const newVal = changes[key].newValue;
    if (!newVal) {
      hardStop();
      return;
    }
    applySavedState(newVal || {});
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.origin && msg.origin !== originKey()) return;
    if (msg.type === "APPLY_ALL" || msg.type === "SYNC_STATE") {
      applySavedState(msg.state || {});
    } else if (msg.type === "STOP") {
      hardStop();
    }
  });

  // ---------- Helpers ----------
  function getElementByXpath(path) {
    return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  }

  function parseLocaleNumber(str) {
    if (!str) return NaN;
    str = String(str).trim();
    const hasDot = str.includes('.');
    const hasComma = str.includes(',');
    if (hasDot && hasComma) {
      const lastDot = str.lastIndexOf('.');
      const lastComma = str.lastIndexOf(',');
      const decimalSep = (lastDot > lastComma) ? '.' : ',';
      if (decimalSep === '.') {
        str = str.replace(/,/g, '');
      } else {
        str = str.replace(/\./g, '').replace(',', '.');
      }
    } else if (hasComma && !hasDot) {
      str = str.replace(',', '.');
    }
    str = str.replace(/[^\d.]/g, '');
    const n = parseFloat(str);
    return Number.isFinite(n) ? n : NaN;
  }

  function formatNumberForRef(num, refSample) {
    if (!Number.isFinite(num)) return '';
    const useComma = !!(refSample && refSample.includes(','));
    let decimals = 8;
    if (refSample) {
      const m = refSample.match(/[.,](\d+)/);
      if (m) decimals = Math.min(8, m[1].length);
    }
    let s = num.toFixed(decimals);
    if (s.startsWith('.')) s = '0' + s;
    if (s.startsWith('-.')) s = '-0' + s.slice(1);
    if (useComma) s = s.replace('.', ',');
    return s;
  }

  function setInputValue(el, val) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter || !el) return;
    if (el.value === val) return;
    setter.call(el, val);
    try { el.setAttribute("value", val); } catch (e) { }
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function parseNumber(raw) { if (!raw) return NaN; return parseLocaleNumber(raw); }
  function formatLike(rawRef, num) { const ref = rawRef || ''; return formatNumberForRef(num, ref); }

  // ---------- LimitTotal logic ----------
  let sellTimer = null;
  let lastBuySourcePrice = null;

  function tickSell() {
    if (STOPPED) return;
    const priceInput = document.querySelector("#limitPrice");
    const totalSell = document.querySelector('#limitTotal[placeholder="Lệnh bán giới hạn"]');
    if (!priceInput || !totalSell) return;

    const raw = priceInput.value ?? "";
    const parsedPrice = parseNumber(raw);
    if (!Number.isFinite(parsedPrice)) return;

    const totalOff = Number(STATE.totalOffset ?? 0);
    const applyTotalOffset = STATE.autoLimitTotalSell && totalOff >= 1;
    const sourceForTotal = (Number.isFinite(lastBuySourcePrice)) ? lastBuySourcePrice : parsedPrice;

    const outNum = STATE.autoLimitTotalSell
      ? (totalOff >= 1 ? (sourceForTotal - totalOff * 1e-8) : sourceForTotal)
      : parsedPrice;

    const out = formatLike(raw, outNum);
    setInputValue(totalSell, out);
  }

  function startSell() {
    if (STOPPED) return;
    if (sellTimer) return;
    sellTimer = setInterval(tickSell, 120);
    tickSell();
    console.log("[Set rule Lệnh bán giới hạn] Timer ON");
  }
  function stopSell() {
    if (!sellTimer) return;
    clearInterval(sellTimer);
    sellTimer = null;
    console.log("[Set rule Lệnh bán giới hạn] Timer OFF");
  }

  // ---------- Auto click ----------
  let actionTimer = null;
  const XPATH_CONFIRM = "//button[normalize-space(.)='Xác nhận']";
  const XPATH_TIEP_TUC = "//button[normalize-space(.)='Tiếp tục']";
  let lastActionClickAt = 0;
  const ACTION_CLICK_COOLDOWN_MS = 150;
  const ACTION_POLL_INTERVAL_MS = 100;

  function isBuyTabActive() {
    return !!document.querySelector('.bn-tab.bn-tab__buySell.active[aria-controls="bn-tab-pane-0"]');
  }
  function isSellTabActive() {
    return !!document.querySelector('.bn-tab.bn-tab__buySell.active[aria-controls="bn-tab-pane-1"]');
  }

  function tickActionClick() {
    if (STOPPED) return;
    if (!STATE.autoConfirm) return;
    const now = Date.now();

    if (isBuyTabActive()) {
    const btn = getElementByXpath(XPATH_CONFIRM) || getElementByXpath(XPATH_TIEP_TUC);
    if (btn && now - lastActionClickAt > ACTION_CLICK_COOLDOWN_MS) {
        btn.click();
        lastActionClickAt = now;
        console.log("[ActionClick] clicked 'Xác nhận' or 'Tiếp tục'");
    }
    return;
}

    if (isSellTabActive()) {
      const btn = getElementByXpath(XPATH_TIEP_TUC);
      if (btn && now - lastActionClickAt > ACTION_CLICK_COOLDOWN_MS) {
        btn.click();
        lastActionClickAt = now;
        console.log("[ActionClick] clicked 'Tiếp tục'");
      }
      return;
    }
  }

  function startActionClick() {
    if (STOPPED) return;
    if (actionTimer) return;
    actionTimer = setInterval(tickActionClick, ACTION_POLL_INTERVAL_MS);
    tickActionClick();
    console.log("[ActionClick] ON (", ACTION_POLL_INTERVAL_MS, "ms )");
  }
  function stopActionClick() {
    if (!actionTimer) return;
    clearInterval(actionTimer);
    actionTimer = null;
    console.log("[ActionClick] OFF");
  }

// ---------- Volume ----------
let minTimer = null;
function extractAvailableValueRaw() {
  const containers = document.querySelectorAll(".bn-flex.text-TertiaryText.items-center.justify-between.w-full");
  for (const c of containers) {
    if ((c.textContent || "").includes("Khả dụng")) {
      const valueNode = c.querySelector(".text-PrimaryText");
      if (!valueNode) continue;
      const text = valueNode.textContent.trim();
      const match = text.match(/[\d.,]+/);
      if (match) return match[0];
    }
  }
  return "";
}

function tickMin() {
  if (STOPPED) return;

  const isBuy = isBuyTabActive();
  const isSell = isSellTabActive();
  const refSample = document.querySelector('#limitPrice')?.value ?? '';

  if (isBuy) {
    const inputBuy = document.querySelector('#limitTotal[placeholder="Tối thiểu 0,1"]');
    if (!inputBuy) return;
    const rawUser = (STATE.minFieldValue || "").trim();
    if (!rawUser) return;
    const num = parseLocaleNumber(rawUser);
    const out = formatNumberForRef(num, refSample || inputBuy.value || '');
    if (!out) return;
    if (inputBuy.value === out) return;

    setInputValue(inputBuy, out);
    return;
  }

  if (isSell) {
    const inputSell = document.querySelector('#limitAmount');
    if (!inputSell) return;
    const rawAvail = extractAvailableValueRaw();
    if (!rawAvail) return;
    const num = parseLocaleNumber(rawAvail);
    if (!Number.isFinite(num)) return;
    const out = formatNumberForRef(num, refSample || inputSell.value || '');
    if (!out) return;
    if (inputSell.value === out) return;
    
    setInputValue(inputSell, out);
    return;
  }
}

function startMin() {
  if (STOPPED) return;
  if (minTimer) return;
  minTimer = setInterval(tickMin, 500);
  tickMin();
  console.log("[Set volume giao dịch] ON");
}
function stopMin() {
  if (!minTimer) return;
  clearInterval(minTimer);
  minTimer = null;
  console.log("[Set volume giao dịch] OFF");
}

  // ---------- Price watcher ----------
  let priceWatcherTimer = null;
  let observedPriceEl = null;
  let suppressSet = false;
  let lastSeenValue = null;

  function applyRuleAndRecordSource(el, sourceRaw) {
    if (STOPPED) return;

    const price = parseNumber(sourceRaw);
    if (!Number.isFinite(price) || price <= 0) return;

    const buyOff = Math.max(1, Number(STATE.buyOffset || 1));
    const sellOff = Math.max(1, Number(STATE.sellOffset || 1));
    const totalOff = Number(STATE.totalOffset ?? 0);

    // limitPrice theo flag & tab
    let desiredNum;
    if (isBuyTabActive() && STATE.autoBuyOffset) {
      desiredNum = price + buyOff * 1e-8;
    } else if (isSellTabActive() && STATE.autoSellOffset) {
      desiredNum = price - sellOff * 1e-8;
    } else {
      desiredNum = price;
    }

    const out = formatLike(sourceRaw, desiredNum);

    // set price input
    suppressSet = true;
    setInputValue(el, out);
    setTimeout(() => { suppressSet = false; }, 250);

    // Nếu Buy active & limitTotal bật: set limitTotal ngay theo totalOff
    if (isBuyTabActive() && STATE.autoLimitTotalSell) {
      lastBuySourcePrice = price;
      const totalEl = document.querySelector('#limitTotal[placeholder="Lệnh bán giới hạn"]');
      if (totalEl) {
        const totalNum = totalOff >= 1 ? (price - totalOff * 1e-8) : price;
        const totalOut = formatLike(sourceRaw, totalNum);
        setInputValue(totalEl, totalOut);
      }
    }

    // Nếu Sell active: set #limitAmount từ “Khả dụng”
    if (isSellTabActive()) {
      const inputSell = document.querySelector('#limitAmount');
      const rawAvail = extractAvailableValueRaw();
      if (inputSell && rawAvail) {
        const num = parseLocaleNumber(rawAvail);
        if (Number.isFinite(num)) {
          const out2 = formatNumberForRef(num, el.value || '');
          setInputValue(inputSell, out2);
        }
      }
    }

    lastSeenValue = out;
    console.log("[PriceWatcher] applied rule (source->adjusted). source=", sourceRaw, " adjusted=", out);
  }

  function ensureObservedPriceEl() {
    const el = document.querySelector("#limitPrice");
    if (!el) return null;
    if (observedPriceEl !== el) {
      try { if (observedPriceEl) observedPriceEl.removeEventListener("input", onPriceInput); } catch (e) { }
      observedPriceEl = el;
      observedPriceEl.addEventListener("input", onPriceInput, { passive: true });
      lastSeenValue = el.value ?? null;
    }
    return observedPriceEl;
  }

  function onPriceInput(e) {
    if (STOPPED) return;
    if (suppressSet) return;
    const el = e.target;
    if (!el) return;
    const cur = el.value ?? '';
    if (cur === lastSeenValue) return;
    if (!isBuyTabActive() && !isSellTabActive()) {
      lastSeenValue = cur;
      return;
    }
    applyRuleAndRecordSource(el, cur);
  }

  function startPriceWatcher() {
    if (STOPPED) return;
    if (priceWatcherTimer) return;

    priceWatcherTimer = setInterval(() => {
      try {
        if (STOPPED) return;
        const el = ensureObservedPriceEl();
        if (!el) {
          lastSeenValue = null;
          lastBuySourcePrice = null;
          return;
        }
        if (!isBuyTabActive() && !isSellTabActive()) {
          lastSeenValue = el.value ?? lastSeenValue;
          return;
        }
        const cur = el.value ?? '';
        if (suppressSet) return;
        if (cur === lastSeenValue) return;
        applyRuleAndRecordSource(el, cur);
      } catch (err) {
        console.warn("[PriceWatcher] poll error", err);
      }
    }, 300);

    const existing = document.querySelector("#limitPrice");
    if (existing) {
      observedPriceEl = existing;
      observedPriceEl.addEventListener("input", onPriceInput, { passive: true });
      lastSeenValue = existing.value ?? null;
      const cur = existing.value ?? '';
      try {
        const price = parseNumber(cur);
        if (Number.isFinite(price) && price > 0 && (STATE.autoBuyOffset || STATE.autoSellOffset) && (isBuyTabActive() || isSellTabActive())) {
          applyRuleAndRecordSource(existing, cur);
        }
      } catch (e) { }
    }

    console.log("[PriceWatcher] started (restricted to /alpha/ token pages)");
  }

  function stopPriceWatcher() {
    if (priceWatcherTimer) { clearInterval(priceWatcherTimer); priceWatcherTimer = null; }
    try { if (observedPriceEl) observedPriceEl.removeEventListener("input", onPriceInput); } catch (e) { }
    observedPriceEl = null;
    suppressSet = false;
    lastSeenValue = null;
    lastBuySourcePrice = null;
    console.log("[PriceWatcher] stopped");
  }

  // ---------- STOP ----------
  function hardStop() {
    STOPPED = true;
    stopActionClick();
    stopMin();
    stopPriceWatcher();
    stopSell();
    console.log("[AutoAlpha] HARD STOP — timers/listeners stopped and state cleared");
  }

  // ---------- Start ----------
  loadStateForOrigin();
}

