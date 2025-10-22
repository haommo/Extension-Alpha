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
    // *** ĐÃ KHÔI PHỤC startMin/stopMin ***
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
    if (isBuyTabActive()) return; // Ngăn chạy ở tab Mua

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
  // *** TOÀN BỘ KHỐI NÀY ĐÃ ĐƯỢC KHÔI PHỤC VÀ CẬP NHẬT ***
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

    // GIẢI PHÁP: Nếu người dùng đang gõ vào BẤT KỲ ô input/textarea nào, hãy dừng lại
    if (document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA")) {
      return;
    }

    const isBuy = isBuyTabActive();
    const isSell = isSellTabActive();
    const refSample = document.querySelector('#limitPrice')?.value ?? '';

    // --- LOGIC MUA ---
    if (isBuy) {
      const inputBuy = document.querySelector('#limitTotal[placeholder="Tối thiểu 0,1"]');
      if (!inputBuy) return;

      // Lấy giá trị auto-fill (minFieldValue)
      const rawUser = (STATE.minFieldValue || "").trim();
      if (!rawUser) return; // Không có giá trị min thì không làm gì
      const numUser = parseLocaleNumber(rawUser);
      const out = formatNumberForRef(numUser, refSample || inputBuy.value || '');
      if (!out) return;

      // Chỉ set nếu giá trị hiện tại KHÁC giá trị mong muốn
      if (inputBuy.value !== out) {
        setInputValue(inputBuy, out);
      }
      return;
    }

    // --- LOGIC BÁN (So sánh 2 chữ số thập phân) ---
    if (isSell) {
      const inputSell = document.querySelector('#limitAmount');
      if (!inputSell) return;

      // Lấy giá trị auto-fill (Available)
      const rawAvail = extractAvailableValueRaw();
      if (!rawAvail) return;
      const numAvail = parseLocaleNumber(rawAvail); // e.g., 0.047745
      if (!Number.isFinite(numAvail)) return;
      const out = formatNumberForRef(numAvail, refSample || inputSell.value || ''); // String đầy đủ
      if (!out) return;

      // Lấy giá trị hiện tại
      const currentValNum = parseLocaleNumber(inputSell.value); // e.g., 0.04

      let shouldOverwrite = false;

      if (!Number.isFinite(currentValNum)) {
        // Nếu giá trị hiện tại không phải là số (trống, "abc", v.v.)
        shouldOverwrite = true;
      } else {
        // So sánh giá trị sau khi đã làm tròn xuống 2 chữ số thập phân
        const availFloored = Math.floor(numAvail * 100);
        const currentFloored = Math.floor(currentValNum * 100);

        if (availFloored !== currentFloored) {
          shouldOverwrite = true;
        }
      }

      if (shouldOverwrite && inputSell.value !== out) {
        setInputValue(inputSell, out);
      }
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
  // *** KẾT THÚC KHỐI KHÔI PHỤC ***


  // ---------- Price watcher ----------
  let priceWatcherTimer = null;
  let observedSourceEl = null;
  let suppressSet = false;
  let lastSeenValue = null;

  // *** HÀM ĐÃ ĐƯỢC CẬP NHẬT (Đã xóa logic Volume) ***
  function applyRuleAndRecordSource(sourceEl, sourceRaw) {
    if (STOPPED) return;
    if (!sourceEl) return;

    const price = parseNumber(sourceRaw);
    if (!Number.isFinite(price) || price <= 0) return;

    const buyOff = Math.max(1, Number(STATE.buyOffset || 1));
    const sellOff = Math.max(1, Number(STATE.sellOffset || 1));
    const totalOff = Number(STATE.totalOffset ?? 0);

    if (isBuyTabActive() && STATE.autoBuyOffset) {
      const targetPriceEl = document.querySelector("#limitPrice");
      if (!targetPriceEl) return;

      const desiredPriceNum = price + buyOff * 1e-8;
      const desiredTotalNum = price - totalOff * 1e-8;

      const outPrice = formatLike(sourceRaw, desiredPriceNum);
      const outTotal = formatLike(sourceRaw, desiredTotalNum);

      suppressSet = true;
      setInputValue(targetPriceEl, outPrice);
      setInputValue(sourceEl, outTotal);
      setTimeout(() => { suppressSet = false; }, 250);

      // *** ĐÃ XÓA logic volume (mua) tích hợp ***

      lastSeenValue = outTotal;
      console.log("[PriceWatcher] applied rule (Buy). source=", sourceRaw, " priceSet=", outPrice, " totalSet=", outTotal);

    } else if (isSellTabActive() && STATE.autoSellOffset) {
      const desiredNum = price - sellOff * 1e-8;
      const out = formatLike(sourceRaw, desiredNum);

      suppressSet = true;
      setInputValue(sourceEl, out);
      setTimeout(() => { suppressSet = false; }, 250);

      // *** ĐÃ XÓA logic volume (bán) tích hợp ***

      lastSeenValue = out;
      console.log("[PriceWatcher] applied rule (Sell). source=", sourceRaw, " adjusted=", out);

    } else {
      lastSeenValue = sourceRaw;
      return;
    }
  }

  function ensureObservedSourceEl() {
    let sourceSelector = null;
    if (isBuyTabActive() && STATE.autoBuyOffset) {
      sourceSelector = '#limitTotal[placeholder="Lệnh bán giới hạn"]';
    } else if (isSellTabActive() && STATE.autoSellOffset) {
      sourceSelector = "#limitPrice";
    }

    const newSourceEl = sourceSelector ? document.querySelector(sourceSelector) : null;

    if (observedSourceEl !== newSourceEl) {
      try { if (observedSourceEl) observedSourceEl.removeEventListener("input", onSourceInput); } catch (e) { }

      observedSourceEl = newSourceEl;

      if (observedSourceEl) {
        observedSourceEl.addEventListener("input", onSourceInput, { passive: true });
        lastSeenValue = observedSourceEl.value ?? null;
      } else {
        lastSeenValue = null;
      }
    }
    return observedSourceEl;
  }

  function onSourceInput(e) {
    if (STOPPED) return;
    if (suppressSet) return;
    const el = e.target;
    if (!el) return;
    const cur = el.value ?? '';
    if (cur === lastSeenValue) return;

    applyRuleAndRecordSource(el, cur);
  }

  function startPriceWatcher() {
    if (STOPPED) return;
    if (priceWatcherTimer) return;

    priceWatcherTimer = setInterval(() => {
      try {
        if (STOPPED) return;

        const sourceEl = ensureObservedSourceEl();

        if (!sourceEl) {
          lastSeenValue = null;
          return;
        }

        if (!((isBuyTabActive() && STATE.autoBuyOffset) || (isSellTabActive() && STATE.autoSellOffset))) {
          lastSeenValue = sourceEl.value ?? lastSeenValue;
          return;
        }

        const cur = sourceEl.value ?? '';
        if (suppressSet) return;
        if (cur === lastSeenValue) return;

        applyRuleAndRecordSource(sourceEl, cur);

      } catch (err) {
        console.warn("[PriceWatcher] poll error", err);
      }
    }, 300);

    const initialSourceEl = ensureObservedSourceEl();
    if (initialSourceEl) {
      try {
        const cur = initialSourceEl.value ?? '';
        const price = parseNumber(cur);
        if (Number.isFinite(price) && price > 0) {
          applyRuleAndRecordSource(initialSourceEl, cur);
        }
      } catch (e) { }
    }

    console.log("[PriceWatcher] started (restricted to /alpha/ token pages)");
    D
  }

  function stopPriceWatcher() {
    if (priceWatcherTimer) { clearInterval(priceWatcherTimer); priceWatcherTimer = null; }
    try { if (observedSourceEl) observedSourceEl.removeEventListener("input", onSourceInput); } catch (e) { }
    observedSourceEl = null;
    suppressSet = false;
    lastSeenValue = null;
    lastBuySourcePrice = null;
    console.log("[PriceWatcher] stopped");
  }

  // ---------- STOP ----------
  function hardStop() {
    STOPPED = true;
    stopActionClick();
    // *** ĐÃ KHÔI PHỤC stopMin() ***
    stopMin();
    stopPriceWatcher();
    stopSell();
    console.log("[AutoAlpha] HARD STOP — timers/listeners stopped and state cleared");
  }

  // ---------- Start ----------
  loadStateForOrigin();
}