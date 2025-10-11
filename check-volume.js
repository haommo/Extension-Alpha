// check-volume.js
(async function () {
  function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  function clickLichSu() {
    const divs = document.querySelectorAll("div");
    for (let div of divs) {
      if (div.innerText.trim() === "Lịch sử đặt lệnh") {
        div.click();
        return true;
      }
    }
    return false;
  }

  function parseVolume(text) {
    if (!text) return 0;
    let s = String(text)
      .replace(/\u00A0/g, ' ')
      .replace(/USDT/gi, '')
      .replace(/\s+/g, '')
      .replace(/\./g, '')
      .replace(/,/g, '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  function isToday(datetimeStr) {
    if (!datetimeStr) return false;
    const todayStr = new Date().toISOString().slice(0, 10);
    return datetimeStr.trim().startsWith(todayStr);
  }

  function getRows() {
    return document.querySelectorAll("tr.bn-web-table-row.bn-web-table-row-level-0");
  }

  function getScrollableContainer() {
    const candidates = [
      '.bn-web-table-body',
      '.bn-table-body',
      '.bn-web-table',
      '.ant-table-body',
      '.bn-virtual-list',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight) return el;
    }
    return document.scrollingElement || document.documentElement || document.body;
  }

  async function loadAllRowsByScroll(maxTries = 30) {
    const container = getScrollableContainer();
    let lastCount = -1;
    let stableTries = 0;

    for (let i = 0; i < maxTries; i++) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
      await delay(800);

      const rowsNow = getRows().length;
      if (rowsNow === lastCount) {
        stableTries++;
        if (stableTries >= 2) break;
      } else {
        stableTries = 0;
        lastCount = rowsNow;
      }
    }
  }

  async function sumTodayBuyVolume() {
    let total = 0;
    for (const row of getRows()) {
      const datetime = row.querySelector('td[aria-colindex="1"]')?.innerText.trim();
      const loai = row.querySelector('td[aria-colindex="4"]')?.innerText.trim();
      const volumeTxt = row.querySelector('td[aria-colindex="9"] div')?.innerText.trim();
      const status = row.querySelector('td[aria-colindex="11"] div')?.innerText.trim();

      if (!datetime || !volumeTxt) continue;
      if (isToday(datetime) && loai === "Mua" && (status === "Đã khớp" || status === "Khớp một phần")) {
        total += parseVolume(volumeTxt);
      }
    }
    return total;
  }

  // --- Main ---
  if (!clickLichSu()) {
    console.log("Không tìm thấy tab 'Lịch sử đặt lệnh'");
    return null; 
  }

  await delay(1500);
  await loadAllRowsByScroll();
  const totalVolume = await sumTodayBuyVolume();
  return totalVolume;
})();