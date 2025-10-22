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

  // *** HÀM MỚI: Chuyển đổi chuỗi ngày giờ của Binance thành đối tượng Date ***
  function parseDate(datetimeStr) {
    if (!datetimeStr) return null;
    try {
      const [dateStr, timeStr] = datetimeStr.trim().split(' ');
      if (!dateStr || !timeStr) return null;
      const [year, month, day] = dateStr.split('-').map(Number);
      const [hour, minute, second] = timeStr.split(':').map(Number);
      // Kiểm tra nếu bất kỳ phần nào không phải là số
      if ([year, month, day, hour, minute, second].some(isNaN)) return null;
      // Date constructor dùng tháng 0-indexed
      const d = new Date(year, month - 1, day, hour, minute, second);
      if (isNaN(d.getTime())) return null; // Kiểm tra ngày không hợp lệ
      return d;
    } catch (e) {
      console.warn('Lỗi parse ngày:', datetimeStr, e);
      return null;
    }
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

  async function sumTodayBuyVolume(startTime, endTime) {
    let total = 0;
    for (const row of getRows()) {
      const datetime = row.querySelector('td[aria-colindex="1"]')?.innerText.trim();
      const loai = row.querySelector('td[aria-colindex="4"]')?.innerText.trim();
      const volumeTxt = row.querySelector('td[aria-colindex="9"] div')?.innerText.trim();
      const status = row.querySelector('td[aria-colindex="11"] div')?.innerText.trim();

      if (!datetime || !volumeTxt) continue;

      const rowDate = parseDate(datetime);
      if (!rowDate) continue; 

      if (
        rowDate >= startTime &&
        rowDate < endTime &&
        loai === "Mua" &&
        (status === "Đã khớp" || status === "Khớp một phần")
      ) {
        total += parseVolume(volumeTxt);
      }
    }
    return total;
  }


  const CUTOFF_HOUR = 7; // 7:00 AM
  const now = new Date(); // Thời gian check hiện tại

  let endTime = new Date(now);
  endTime.setHours(CUTOFF_HOUR, 0, 0, 0); // Đặt mốc 7:00:00

  if (now.getHours() >= CUTOFF_HOUR) {
    endTime.setDate(endTime.getDate() + 1);
  }
 
  let startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

  if (!clickLichSu()) {
    console.log("Không tìm thấy tab 'Lịch sử đặt lệnh'");
    return null;
  }

  await delay(2000);
  await loadAllRowsByScroll();

  // *** CẬP NHẬT: Truyền startTime và endTime vào hàm ***
  const totalVolume = await sumTodayBuyVolume(startTime, endTime);
  return totalVolume;
})();