//popup.js
function getOriginFromUrl(url) {
  try { return new URL(url).origin; } catch { return null; }
}
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
async function loadState(origin) {
  return new Promise((resolve) => {
    chrome.storage.local.get([origin], (res) => {
      resolve(res[origin] || {
        // LimitTotal
        autoLimitTotalSell: false,
        totalOffset: 0,
        // LimitPrice (Buy/Sell)
        autoBuyOffset: false,
        buyOffset: 1,
        autoSellOffset: false,
        sellOffset: 1,
        // Auto click
        autoConfirm: false,
        // Volume
        autoMinField: false,
        minFieldValue: ""
      });
    });
  });
}
async function saveState(origin, state) {
  return new Promise((resolve) =>
    chrome.storage.local.set({ [origin]: state }, resolve)
  );
}
async function removeState(origin) {
  return new Promise((resolve) =>
    chrome.storage.local.remove([origin], resolve)
  );
}
async function sendToTab(tabId, msg) {
  chrome.tabs.sendMessage(tabId, msg);
}

document.addEventListener("DOMContentLoaded", async () => {
  // refs
  const toggleTotal   = document.getElementById("toggleLimitTotalSell");
  const totalOffsetEl = document.getElementById("totalOffset");
  const totalInline   = totalOffsetEl ? totalOffsetEl.closest(".inline-input") : null;

  const toggleBuy     = document.getElementById("toggleBuyOffset");
  const buyOffsetEl   = document.getElementById("buyOffset");
  const buyInline     = buyOffsetEl ? buyOffsetEl.closest(".inline-input") : null;

  const toggleSell    = document.getElementById("toggleSellOffset");
  const sellOffsetEl  = document.getElementById("sellOffset");
  const sellInline    = sellOffsetEl ? sellOffsetEl.closest(".inline-input") : null;

  const toggleMin     = document.getElementById("toggleMinField");
  const minValueEl    = document.getElementById("minFieldValue");
  const minInline     = minValueEl ? minValueEl.closest(".inline-input") : null;

  const toggleConfirm = document.getElementById("toggleConfirm");

  const btnSave       = document.getElementById("btnSave");
  const btnStop       = document.getElementById("btnStop");

  let tab = null;
  try { tab = await getActiveTab(); } catch {}
  const origin = getOriginFromUrl(tab?.url || location.origin) || location.origin;
  const state = await loadState(origin);

  // INIT UI
  if (toggleTotal)     toggleTotal.checked = !!state.autoLimitTotalSell;
  if (totalOffsetEl)   totalOffsetEl.value = Number((state.totalOffset ?? 0));
  if (totalInline)     totalInline.classList.toggle("hide", !(toggleTotal && toggleTotal.checked));

  if (toggleBuy)       toggleBuy.checked   = !!state.autoBuyOffset;
  if (buyOffsetEl)     buyOffsetEl.value   = Number(state.buyOffset || 1);
  if (buyInline)       buyInline.classList.toggle("hide", !(toggleBuy && toggleBuy.checked));

  if (toggleSell)      toggleSell.checked  = !!state.autoSellOffset;
  if (sellOffsetEl)    sellOffsetEl.value  = Number(state.sellOffset || 1);
  if (sellInline)      sellInline.classList.toggle("hide", !(toggleSell && toggleSell.checked));

  if (toggleMin)       toggleMin.checked   = !!state.autoMinField;
  if (minValueEl)      minValueEl.value    = state.minFieldValue || "";
  if (minInline)       minInline.classList.toggle("hide", !(toggleMin && toggleMin.checked));

  if (toggleConfirm)   toggleConfirm.checked = !!state.autoConfirm;

  // Toggle show/hide inline
  toggleTotal?.addEventListener("change", () => {
    totalInline?.classList.toggle("hide", !toggleTotal.checked);
  });
  toggleBuy?.addEventListener("change", () => {
    buyInline?.classList.toggle("hide", !toggleBuy.checked);
  });
  toggleSell?.addEventListener("change", () => {
    sellInline?.classList.toggle("hide", !toggleSell.checked);
  });
  toggleMin?.addEventListener("change", () => {
    minInline?.classList.toggle("hide", !toggleMin.checked);
  });

  // SAVE
  btnSave?.addEventListener("click", async () => {
    for (const el of [totalOffsetEl, buyOffsetEl, sellOffsetEl]) {
      el?.classList.remove("invalid");
      el?.removeAttribute("title");
    }

    let totalOffset = parseInt(totalOffsetEl?.value ?? "0", 10);
    let buyOffset   = parseInt(buyOffsetEl?.value   ?? "1", 10);
    let sellOffset  = parseInt(sellOffsetEl?.value  ?? "1", 10);

    const invalids = [];
    if (!Number.isFinite(totalOffset) || totalOffset < 0) invalids.push(totalOffsetEl);
    if (!Number.isFinite(buyOffset)   || buyOffset   < 1) invalids.push(buyOffsetEl);
    if (!Number.isFinite(sellOffset)  || sellOffset  < 1) invalids.push(sellOffsetEl);

    if (invalids.length) {
      for (const el of invalids) {
        if (!el) continue;
        el.classList.add("invalid");
        el.setAttribute("title", "Giá trị phải ≥ 1");
      }
      alert("Buy/Sell offset phải ≥ 1; Total offset phải ≥ 0");
      invalids[0]?.focus();
      return;
    }

    const newState = {
      autoLimitTotalSell: !!toggleTotal?.checked,
      totalOffset,
      autoBuyOffset: !!toggleBuy?.checked,
      buyOffset,
      autoSellOffset: !!toggleSell?.checked,
      sellOffset,
      autoConfirm: !!toggleConfirm?.checked,
      autoMinField: !!toggleMin?.checked,
      minFieldValue: (minValueEl?.value || "").trim()
    };

    await saveState(origin, newState);
    if (tab?.id) await sendToTab(tab.id, { type: "APPLY_ALL", state: newState, origin });

    btnSave.textContent = "Saved ✓";
    chrome.tabs.reload(tab.id);
    setTimeout(() => (btnSave.textContent = "Save"), 1200);
  });

  // STOP & CLEAR
  btnStop?.addEventListener("click", async () => {
    await removeState(origin); // xóa cấu hình domain
    if (tab?.id) await sendToTab(tab.id, { type: "STOP", origin });
    btnStop.textContent = "Stopped ✓";
    chrome.tabs.reload(tab.id);
    setTimeout(() => (btnStop.textContent = "Stop & Clear"), 1200);
  });

  // Đồng bộ lần đầu
  if (tab?.id) await sendToTab(tab.id, { type: "SYNC_STATE", state, origin });
});
