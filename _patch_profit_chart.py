# -*- coding: utf-8 -*-
p = r"D:\KYC\admin-headquarters.html"
with open(p, "r", encoding="utf-8") as f:
    s = f.read()

# 1) enrichHqPointHistoryBalances
s = s.replace(
    """                var amt = pickPointLedgerAmountUsdt(r);
                var grant = r.kind === 'grant';
                var signed = grant ? amt : -amt;""",
    """                var amt = pickPointLedgerAmountUsdt(r);
                var grant = r.kind === 'grant' || r.kind === 'deposit';
                var signed = grant ? amt : -amt;""",
    1,
)

# 2) point ledger filter options
s = s.replace(
    """                    <option value="all" selected>전체</option>
                    <option value="grant">지급</option>
                    <option value="deduct">차감</option>
                </select>
                <label for="pointLedgerStatusFilter">상태</label>""",
    """                    <option value="all" selected>전체</option>
                    <option value="deposit">입금</option>
                    <option value="grant">지급</option>
                    <option value="deduct">차감</option>
                </select>
                <label for="pointLedgerStatusFilter">상태</label>""",
    1,
)

# 3) overview chart description
s = s.replace(
    """                <h3 class="overview-chart-title">포인트 내역 · 본사 수익 추이</h3>
                <p class="overview-chart-desc">최근 30일간 가맹점 포인트 <strong>지급</strong>·<strong>차감</strong>을 일별로 집계합니다. 차감은 가맹점에서 회수한 USDT, 지급은 가맹점에 지급한 USDT입니다. (취소 건은 제외)</p>""",
    """                <h3 class="overview-chart-title">본사 순수익 추이 (입금 − 지급 − 차감)</h3>
                <p class="overview-chart-desc">최근 30일간 <strong>입금</strong>(가맹점 USDT 충전)·<strong>지급</strong>·<strong>차감</strong>을 일별로 합산한 뒤, <strong>순수익 = 입금 − 지급 − 차감</strong>으로 표시합니다. (취소 건은 제외)</p>""",
    1,
)

# 4) aggregateOverviewPointByDay — replace whole function
old_agg = """        function aggregateOverviewPointByDay(rows) {
            var grant = {};
            var deduct = {};
            rows.forEach(function (r) {
                if (!overviewPointRowCountsForChart(r)) return;
                var d = new Date(r.at);
                if (isNaN(d.getTime())) return;
                var key = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
                var amt = Math.abs(Number(r.amount));
                if (!isFinite(amt)) return;
                if (r.kind === 'grant') grant[key] = (grant[key] || 0) + amt;
                else if (r.kind === 'deduct') deduct[key] = (deduct[key] || 0) + amt;
            });
            return { grant: grant, deduct: deduct };
        }"""
new_agg = """        function aggregateOverviewPointByDay(rows) {
            var deposit = {};
            var grant = {};
            var deduct = {};
            rows.forEach(function (r) {
                if (!overviewPointRowCountsForChart(r)) return;
                var d = new Date(r.at);
                if (isNaN(d.getTime())) return;
                var key = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
                var amt = Math.abs(Number(r.amount));
                if (!isFinite(amt)) return;
                if (r.kind === 'deposit') deposit[key] = (deposit[key] || 0) + amt;
                else if (r.kind === 'grant') grant[key] = (grant[key] || 0) + amt;
                else if (r.kind === 'deduct') deduct[key] = (deduct[key] || 0) + amt;
            });
            return { deposit: deposit, grant: grant, deduct: deduct };
        }"""
if old_agg not in s:
    raise SystemExit("aggregateOverviewPointByDay not found")
s = s.replace(old_agg, new_agg, 1)

# 5) replace updateOverviewRevenueChart — find start through first dataset closing - do full function replace via markers
start = s.find("        function updateOverviewRevenueChart() {")
if start < 0:
    raise SystemExit("updateOverviewRevenueChart not found")
end = s.find("        function parsePointLedgerDateInput(yyyymmdd) {", start)
if end < 0:
    raise SystemExit("parsePointLedgerDateInput not found")
new_fn = r"""        function updateOverviewRevenueChart() {
            var canvas = document.getElementById('hqRevenueChart');
            var foot = document.getElementById('overviewChartFootnote');
            if (!canvas || typeof Chart === 'undefined') return;
            var rows = collectAllPointLedgerRows();
            var agg = aggregateOverviewPointByDay(rows);
            var keys = getOverviewLastNDayKeys(30);
            var depositData = keys.map(function (k) { return Math.round((agg.deposit[k] || 0) * 10) / 10; });
            var grantData = keys.map(function (k) { return Math.round((agg.grant[k] || 0) * 10) / 10; });
            var deductData = keys.map(function (k) { return Math.round((agg.deduct[k] || 0) * 10) / 10; });
            var netData = keys.map(function (_, i) {
                return Math.round((depositData[i] - grantData[i] - deductData[i]) * 10) / 10;
            });
            var displayLabels = keys.map(function (k) {
                var p = k.split('-');
                return p[1] + '/' + p[2];
            });
            var ctx = canvas.getContext('2d');
            if (hqRevenueChartInstance) {
                hqRevenueChartInstance.destroy();
                hqRevenueChartInstance = null;
            }
            var h = canvas.parentElement && canvas.parentElement.clientHeight ? canvas.parentElement.clientHeight : 280;
            var gNet = ctx.createLinearGradient(0, 0, 0, h);
            gNet.addColorStop(0, 'rgba(56, 189, 248, 0.38)');
            gNet.addColorStop(1, 'rgba(56, 189, 248, 0.03)');
            var totalDep = depositData.reduce(function (a, b) { return a + b; }, 0);
            var totalGrant = grantData.reduce(function (a, b) { return a + b; }, 0);
            var totalDeduct = deductData.reduce(function (a, b) { return a + b; }, 0);
            var totalNet = Math.round((totalDep - totalGrant - totalDeduct) * 10) / 10;
            if (foot) {
                foot.textContent = '30일 합계 · 입금 ' + totalDep.toLocaleString('en-US', { maximumFractionDigits: 1 })
                    + ' − 지급 ' + totalGrant.toLocaleString('en-US', { maximumFractionDigits: 1 })
                    + ' − 차감 ' + totalDeduct.toLocaleString('en-US', { maximumFractionDigits: 1 })
                    + ' = 순수익 ' + totalNet.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' USDT';
            }
            hqRevenueChartInstance = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: displayLabels,
                    datasets: [
                        {
                            label: '본사 순수익 (입금 − 지급 − 차감)',
                            data: netData,
                            borderColor: 'rgba(56, 189, 248, 1)',
                            backgroundColor: gNet,
                            fill: true,
                            tension: 0.38,
                            pointRadius: 0,
                            pointHoverRadius: 5,
                            borderWidth: 2.75,
                            pointBackgroundColor: 'rgba(56, 189, 248, 1)',
                            pointBorderColor: '#0c4a6e',
                        },
                        {
                            label: '입금 (USDT)',
                            data: depositData,
                            borderColor: 'rgba(167, 139, 250, 0.85)',
                            backgroundColor: 'transparent',
                            fill: false,
                            tension: 0.35,
                            pointRadius: 0,
                            borderWidth: 1.5,
                            borderDash: [6, 4],
                        },
                        {
                            label: '지급 (USDT)',
                            data: grantData,
                            borderColor: 'rgba(251, 191, 36, 0.75)',
                            backgroundColor: 'transparent',
                            fill: false,
                            tension: 0.35,
                            pointRadius: 0,
                            borderWidth: 1.5,
                            borderDash: [4, 4],
                        },
                        {
                            label: '차감 (USDT)',
                            data: deductData,
                            borderColor: 'rgba(248, 113, 113, 0.8)',
                            backgroundColor: 'transparent',
                            fill: false,
                            tension: 0.35,
                            pointRadius: 0,
                            borderWidth: 1.5,
                            borderDash: [2, 3],
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: {
                            position: 'top',
                            align: 'end',
                            labels: {
                                color: 'rgba(226, 232, 240, 0.92)',
                                font: { size: 11, weight: '600' },
                                usePointStyle: true,
                                padding: 10,
                            },
                        },
                        tooltip: {
                            backgroundColor: 'rgba(15, 23, 42, 0.94)',
                            titleColor: '#f1f5f9',
                            bodyColor: '#e2e8f0',
                            borderColor: 'rgba(148, 163, 184, 0.35)',
                            borderWidth: 1,
                            padding: 12,
                            callbacks: {
                                label: function (ctx) {
                                    var v = ctx.parsed.y != null ? ctx.parsed.y : 0;
                                    return ctx.dataset.label + ': ' + v.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' USDT';
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255,255,255,0.06)', drawBorder: false },
                            ticks: {
                                color: 'rgba(148, 163, 184, 0.95)',
                                maxRotation: 0,
                                autoSkip: true,
                                maxTicksLimit: 12,
                                font: { size: 11 },
                            },
                        },
                        y: {
                            grid: { color: 'rgba(255,255,255,0.06)', drawBorder: false },
                            ticks: {
                                color: 'rgba(148, 163, 184, 0.95)',
                                font: { size: 11 },
                                callback: function (v) { return v.toLocaleString('en-US', { maximumFractionDigits: 1 }); },
                            },
                        },
                    },
                },
            });
        }

"""
s = s[:start] + new_fn + s[end:]

# 6) renderGlobalPointLedger row builder — replace grant/kCls block
old_rgl = """                var grant = r.kind === 'grant';
                var kCls = grant ? 'td-point-ledger-kind td-point-ledger-grant' : 'td-point-ledger-kind td-point-ledger-deduct';
                var chCls = grant ? 'td-point-ledger-amt td-point-ledger-amt-grant' : 'td-point-ledger-amt td-point-ledger-amt-deduct';
                var kindLabel = grant ? '지급' : '차감';"""
new_rgl = """                var isDeposit = r.kind === 'deposit';
                var grant = r.kind === 'grant';
                var kCls = isDeposit ? 'td-point-ledger-kind td-point-ledger-deposit' : (grant ? 'td-point-ledger-kind td-point-ledger-grant' : 'td-point-ledger-kind td-point-ledger-deduct');
                var chCls = isDeposit ? 'td-point-ledger-amt td-point-ledger-amt-deposit' : (grant ? 'td-point-ledger-amt td-point-ledger-amt-grant' : 'td-point-ledger-amt td-point-ledger-amt-deduct');
                var kindLabel = isDeposit ? '입금' : (grant ? '지급' : '차감');"""
if old_rgl not in s:
    raise SystemExit("renderGlobalPointLedger kind block not found")
s = s.replace(old_rgl, new_rgl, 1)

# 7) renderStorePointHistoryBody
old_rs = """                var grant = r.kind === 'grant';
                var kindClass = grant ? 'td-kind-grant' : 'td-kind-deduct';
                var amtClass = grant ? 'td-amt-grant' : 'td-amt-deduct';
                var kindLabel = grant ? '지급' : '차감';"""
new_rs = """                var isDep = r.kind === 'deposit';
                var grantLike = r.kind === 'grant' || r.kind === 'deposit';
                var kindClass = isDep ? 'td-kind-deposit' : (r.kind === 'grant' ? 'td-kind-grant' : 'td-kind-deduct');
                var amtClass = isDep ? 'td-amt-deposit' : (r.kind === 'grant' ? 'td-amt-grant' : 'td-amt-deduct');
                var kindLabel = isDep ? '입금' : (r.kind === 'grant' ? '지급' : '차감');"""
if old_rs not in s:
    raise SystemExit("renderStorePointHistoryBody block not found")
s = s.replace(old_rs, new_rs, 1)

# 8) formatStorePointUsdtSigned line in renderStorePointHistoryBody - grant -> grantLike
s = s.replace(
    "formatStorePointUsdtSigned(grant, r.amount)",
    "formatStorePointUsdtSigned(grantLike, r.amount)",
    1,
)

# 9) CSS — table point ledger deposit colors (after td-point-ledger-deduct color rules)
css_in = """        .table--point-ledger .td-point-ledger-deduct { color: #fca5a5; font-weight: 600; }"""
css_add = """        .table--point-ledger .td-point-ledger-deposit { color: #67e8f9; font-weight: 600; }
        .table--point-ledger .td-point-ledger-amt-deposit { color: #67e8f9; font-weight: 700; font-variant-numeric: tabular-nums; }
        .table--point-ledger .td-point-ledger-deduct { color: #fca5a5; font-weight: 600; }"""
if css_in not in s:
    raise SystemExit("ledger css anchor not found")
s = s.replace(css_in, css_add, 1)

# 10) modal td-kind-deposit dark theme
css_m = """        #storePointModal .store-point-history-table .td-kind-deduct { color: #fca5a5; }"""
css_m2 = """        #storePointModal .store-point-history-table .td-kind-deposit { color: #67e8f9; font-weight: 600; }
        #storePointModal .store-point-history-table .td-amt-deposit { color: #67e8f9; font-weight: 600; font-variant-numeric: tabular-nums; }
        #storePointModal .store-point-history-table .td-kind-deduct { color: #fca5a5; }"""
if css_m not in s:
    raise SystemExit("modal css anchor not found")
s = s.replace(css_m, css_m2, 1)

with open(p, "w", encoding="utf-8") as f:
    f.write(s)
print("patched admin-headquarters")
