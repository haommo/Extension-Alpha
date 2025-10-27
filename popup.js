// popup.js (Toàn bộ file)

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
        autoLimitTotalSell: false, totalOffset: 0,
        autoBuyOffset: false, buyOffset: 0, 
        autoSellOffset: false, sellOffset: 0,
        autoConfirm: false,
        autoMinField: false, minFieldValue: ""
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
  // refs cho tính năng auto
  const toggleTotal = document.getElementById("toggleLimitTotalSell");
  const totalOffsetEl = document.getElementById("totalOffset");
  const toggleBuy = document.getElementById("toggleBuyOffset");
  const buyOffsetEl = document.getElementById("buyOffset");
  const toggleSell = document.getElementById("toggleSellOffset");
  const sellOffsetEl = document.getElementById("sellOffset");
  const toggleMin = document.getElementById("toggleMinField");
  const minValueEl = document.getElementById("minFieldValue");
  const toggleConfirm = document.getElementById("toggleConfirm");
  const btnSave = document.getElementById("btnSave");
  const btnStop = document.getElementById("btnStop");

  // Refs cho tính năng check volume
  const checkVolumeBtn = document.getElementById("checkVolumeBtn");
  const volumeResultEl = document.getElementById("volumeResult");


  let tab = null;
  try { tab = await getActiveTab(); } catch { }
  const origin = getOriginFromUrl(tab?.url || location.origin) || location.origin;
  const state = await loadState(origin);

  // INIT UI (Phần này giữ nguyên)
  // ... (Toàn bộ phần init UI và toggle show/hide inline giữ nguyên)
  if (toggleTotal) toggleTotal.checked = !!state.autoLimitTotalSell;
  if (totalOffsetEl) totalOffsetEl.value = Number((state.totalOffset ?? 0));
  if (toggleBuy) toggleBuy.checked = !!state.autoBuyOffset;
  if (buyOffsetEl) buyOffsetEl.value = Number(state.buyOffset ?? 0);
  if (toggleSell) toggleSell.checked = !!state.autoSellOffset;
  if (sellOffsetEl) sellOffsetEl.value = Number(state.sellOffset ?? 0);
  if (toggleMin) toggleMin.checked = !!state.autoMinField;
  if (minValueEl) minValueEl.value = state.minFieldValue || "";
  if (toggleConfirm) toggleConfirm.checked = !!state.autoConfirm;

  // Toggle show/hide inline
  function setupToggle(toggle, el) {
    if(!toggle || !el) return;
    const inline = el.closest(".inline-input");
    if(!inline) return;
    inline.classList.toggle("hide", !toggle.checked);
    toggle.addEventListener("change", () => {
        inline.classList.toggle("hide", !toggle.checked);
    });
  }
  setupToggle(toggleTotal, totalOffsetEl);
  setupToggle(toggleBuy, buyOffsetEl);
  setupToggle(toggleSell, sellOffsetEl);
  setupToggle(toggleMin, minValueEl);
  

  // SAVE (Giữ nguyên)
  btnSave?.addEventListener("click", async () => {
    // ... (logic nút save giữ nguyên)
    for (const el of [totalOffsetEl, buyOffsetEl, sellOffsetEl]) {
      el?.classList.remove("invalid");
      el?.removeAttribute("title");
    }
    let totalOffset = parseInt(totalOffsetEl?.value ?? "0", 10);
    let buyOffset = parseInt(buyOffsetEl?.value ?? "0", 10);
    let sellOffset = parseInt(sellOffsetEl?.value ?? "0", 10);
    const invalids = [];
    if (!Number.isFinite(totalOffset) || totalOffset < 0) invalids.push(totalOffsetEl);
    if (!Number.isFinite(buyOffset) || buyOffset < 0) invalids.push(buyOffsetEl);
    if (!Number.isFinite(sellOffset) || sellOffset < 0) invalids.push(sellOffsetEl);
    if (invalids.length) {
      for (const el of invalids) {
        if (!el) continue;
        el.classList.add("invalid");
        el.setAttribute("title", "Giá trị không hợp lệ");
      }
      alert("Buy/Sell/Total offset phải ≥ 0");
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
    btnSave.textContent = "Đã lưu ✓";
    if (tab?.id) chrome.tabs.reload(tab.id);
    setTimeout(() => (btnSave.textContent = "Lưu Cài Đặt"), 1500);
  });

  // STOP & CLEAR (Giữ nguyên)
  btnStop?.addEventListener("click", async () => {
    // ... (logic nút stop giữ nguyên)
    await removeState(origin);
    if (tab?.id) await sendToTab(tab.id, { type: "STOP", origin });
    btnStop.textContent = "Đã dừng ✓";
    if (tab?.id) chrome.tabs.reload(tab.id);
    setTimeout(() => (btnStop.textContent = "Dừng & Xóa"), 1500);
  });
  
  // Đồng bộ lần đầu (Giữ nguyên)
  if (tab?.id) await sendToTab(tab.id, { type: "SYNC_STATE", state, origin });


  // LOGIC MỚI CHO NÚT CHECK VOLUME
  checkVolumeBtn?.addEventListener("click", async () => {
    if (!tab?.id) {
        alert("Không tìm thấy tab đang hoạt động.");
        return;
    }
    
    // Set trạng thái loading
    checkVolumeBtn.innerText = "⏳ Đang check...";
    checkVolumeBtn.disabled = true;
    volumeResultEl.style.display = "none";
    volumeResultEl.className = "result-display"; // reset class

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["check-volume.js"]
    }, (results) => {
      // Reset nút lại khi xong
      checkVolumeBtn.innerText = "🚀 Check Volume Hôm Nay";
      checkVolumeBtn.disabled = false;

      if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
          volumeResultEl.innerText = "❌ Lỗi: " + chrome.runtime.lastError.message;
          volumeResultEl.className = "result-display error";
          volumeResultEl.style.display = "block";
          return;
      }
      
      if (results && results[0] && results[0].result !== null && results[0].result !== undefined) {
        let total = results[0].result;
        // Nhân 4 ở đây
        let finalTotal = total * 4; 
        volumeResultEl.innerText = "⭐ Tổng Volume:" + finalTotal.toLocaleString("vi-VN") + " USDT";
        volumeResultEl.className = "result-display success";
      } else {
        volumeResultEl.innerText = "❌ Không lấy được dữ liệu. Hãy đảm bảo bạn đang ở trang có lịch sử lệnh.";
        volumeResultEl.className = "result-display error";
      }
      volumeResultEl.style.display = "block";
    });
  });
});