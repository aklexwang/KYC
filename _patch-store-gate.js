const fs = require('fs');
const p = require('path').join(__dirname, 'admin-store.html');
let s = fs.readFileSync(p, 'utf8');

const rep = (a, b) => {
  if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 80).replace(/\n/g, '\\n'));
  s = s.split(a).join(b);
};

rep(
  '<h2 class="sidebar-title">Admin Dashboard</h2>',
  '<h2 class="sidebar-title">Admin Dashboard</h2>\n            <p class="sidebar-store-name" id="sidebarStoreNameLine">—</p>'
);

rep(
  '        .dashboard-main { flex: 1; min-width: 0; padding: 20px 20px 30px; }',
  `        .sidebar-store-name {
            font-size: 15px;
            font-weight: 700;
            color: rgba(255,255,255,0.82);
            margin: -8px 0 14px 0;
            line-height: 1.35;
            word-break: break-all;
        }
        .dashboard-main { flex: 1; min-width: 0; padding: 20px 20px 30px; position: relative; }
        .low-balance-overlay {
            display: none;
            position: absolute;
            inset: 0;
            z-index: 40;
            background: rgba(2, 11, 43, 0.78);
            align-items: center;
            justify-content: center;
            flex-direction: column;
            pointer-events: none;
        }
        .dashboard-main--low-balance .low-balance-overlay { display: flex; }
        .low-balance-overlay-text {
            font-size: clamp(24px, 5vw, 40px);
            font-weight: 800;
            color: #fbbf24;
            letter-spacing: -0.03em;
            text-align: center;
            padding: 0 16px;
            box-sizing: border-box;
            text-shadow: 0 2px 12px rgba(0,0,0,0.45);
        }
        .dashboard-main--low-balance .admin-body { pointer-events: none; user-select: none; opacity: 0.35; }
        .dashboard-main--low-balance .admin-header { position: relative; z-index: 50; pointer-events: auto; opacity: 1; }
        .sidebar-menu.menu-locked .menu-item {
            pointer-events: none;
            opacity: 0.35;
            cursor: not-allowed;
        }
        .sidebar-menu.menu-locked .menu-item.active { opacity: 0.4; }`
);

rep(
  '        <div class="dashboard-main">\n            <header class="admin-header">',
  `        <div class="dashboard-main" id="dashboardMain">
            <div id="lowBalanceOverlay" class="low-balance-overlay" aria-hidden="true">
                <p class="low-balance-overlay-text">충전 후 이용하세요</p>
            </div>
            <header class="admin-header">`
);

rep(
  "        window.ADMIN_STORE_ID = '';",
  `        window.ADMIN_STORE_ID = '';
        var MIN_USDT_FOR_USE = 100;
        var lastKnownStoreUsdt = null;`
);

rep(
  '        function setSidebarPointBalanceDisplay(n) {',
  `        function applyStoreUsdtGate(usdtNum) {
            var n = typeof usdtNum === 'number' && !isNaN(usdtNum) ? usdtNum : normalizePointBalanceUsdt(usdtNum);
            lastKnownStoreUsdt = n;
            var main = document.getElementById('dashboardMain');
            var nav = document.querySelector('.sidebar-menu');
            var ov = document.getElementById('lowBalanceOverlay');
            if (!main || !nav) return;
            var low = n < MIN_USDT_FOR_USE;
            main.classList.toggle('dashboard-main--low-balance', low);
            nav.classList.toggle('menu-locked', low);
            if (ov) ov.setAttribute('aria-hidden', low ? 'false' : 'true');
        }

        function setSidebarPointBalanceDisplay(n) {`
);

rep(
  `            if (hintBalance !== undefined && hintBalance !== null && String(hintBalance).trim() !== '') {
                setSidebarPointBalanceDisplay(hintBalance);
                setSidebarPointLoading(false);
                return;
            }`,
  `            if (hintBalance !== undefined && hintBalance !== null && String(hintBalance).trim() !== '') {
                setSidebarPointBalanceDisplay(hintBalance);
                applyStoreUsdtGate(hintBalance);
                setSidebarPointLoading(false);
                return;
            }`
);

rep(
  `            if (!apiBase || !sid) {
                setSidebarPointBalanceDisplay(null);
                setSidebarPointLoading(false);
                return;
            }`,
  `            if (!apiBase || !sid) {
                setSidebarPointBalanceDisplay(null);
                applyStoreUsdtGate(0);
                setSidebarPointLoading(false);
                return;
            }`
);

rep(
  `                    if (found) {
                        var bal = pickStoreBalanceUsdt(found);
                        setSidebarPointBalanceDisplay(bal !== null ? bal : 0);
                    } else {
                        setSidebarPointBalanceDisplay(0);
                    }`,
  `                    if (found) {
                        var bal = pickStoreBalanceUsdt(found);
                        setSidebarPointBalanceDisplay(bal !== null ? bal : 0);
                        applyStoreUsdtGate(bal !== null ? bal : 0);
                    } else {
                        setSidebarPointBalanceDisplay(0);
                        applyStoreUsdtGate(0);
                    }`
);

rep(
  `                .catch(function () {
                    if (sid === 'STORE_001') {
                        setSidebarPointBalanceDisplay(182.5);
                    } else {
                        setSidebarPointBalanceDisplay(null);
                    }
                })`,
  `                .catch(function () {
                    if (sid === 'STORE_001') {
                        setSidebarPointBalanceDisplay(182.5);
                        applyStoreUsdtGate(182.5);
                    } else {
                        setSidebarPointBalanceDisplay(null);
                        applyStoreUsdtGate(0);
                    }
                })`
);

rep(
  '            if (headerStoreNameEl) headerStoreNameEl.textContent = storeName || storeId || \'\';',
  `            if (headerStoreNameEl) headerStoreNameEl.textContent = storeName || storeId || '';
            var sideName = document.getElementById('sidebarStoreNameLine');
            if (sideName) sideName.textContent = storeName || storeId || '—';`
);

fs.writeFileSync(p, s, 'utf8');
console.log('patch ok');
