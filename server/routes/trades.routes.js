const tg = window.Telegram.WebApp;
const tg_id = tg.initDataUnsafe.user.id;

async function loadTrades() {
  try {
    const res = await fetch(`/api/trades/${tg_id}`);
    const data = await res.json();

    if (!data || !data.length) return;

    const container = document.getElementById("trades");
    container.innerHTML = "";

    data.forEach(trade => {
      const pnl = Number(trade.pnl || 0);

      const div = document.createElement("div");
      div.className = "trade-card";

      div.innerHTML = `
        <div><b>${trade.symbol}</b> (${trade.direction})</div>
        <div>Entry: ${trade.entry_price}</div>
        <div>Now: ${trade.current_price}</div>
        <div style="color:${pnl >= 0 ? "lime" : "red"}">
          PNL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
        </div>
      `;

      container.appendChild(div);
    });
  } catch (e) {
    console.error("Load trades error", e);
  }
}

// ⏱️ تحديث كل 3 ثواني
setInterval(loadTrades, 3000);

// أول تحميل
loadTrades();

