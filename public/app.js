// Corner Office Math - the web page. Plain JavaScript, no build step.
(function () {
  const app = document.getElementById('app');
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const COLORS = () => ({ ceo: css('--series-1'), median: css('--series-2'), revenue: css('--series-3') });

  // ---------- formatting ----------
  const money = v => {
    if (v == null || !isFinite(v)) return '–';
    const a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(a >= 1e11 ? 0 : 1) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return '$' + Math.round(v / 1e3) + 'K';
    if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  };
  const moneyFull = v => (v == null ? '–' : '$' + Math.round(v).toLocaleString('en-US'));
  const ratio = v => (v == null ? '–' : Math.round(v).toLocaleString('en-US') + ':1');
  const int = v => (v == null ? '–' : Math.round(v).toLocaleString('en-US'));
  const pct = v => (v == null ? '–' : (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fileTicker = t => t.replace(/[^A-Z0-9-]/gi, '-').toUpperCase();

  // ---------- data ----------
  let indexPromise;
  const getIndex = () => (indexPromise = indexPromise || fetch('/data/index.json').then(r => {
    if (!r.ok) throw new Error('No data yet');
    return r.json();
  }));
  const companyCache = {};
  const getCompany = t => (companyCache[t] = companyCache[t] || fetch(`/data/companies/${fileTicker(t)}.json`).then(r => {
    if (!r.ok) throw new Error('Company not found');
    return r.json();
  }));

  // ---------- routing ----------
  function navigate(url) {
    history.pushState({}, '', url);
    render();
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-link]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });
  window.addEventListener('popstate', render);

  function render() {
    Charts.hideTip();
    const p = location.pathname;
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === p));
    const m = p.match(/^\/company\/([^/]+)\/?$/);
    if (m) return renderCompany(decodeURIComponent(m[1]).toUpperCase());
    if (p === '/about') return renderAbout();
    return renderHome();
  }

  const tile = (label, value, note, color) => `
    <div class="tile">
      <div class="label">${color ? `<i class="swatch" style="background:${color}"></i>` : ''}${label}</div>
      <div class="value">${value}</div>
      ${note ? `<div class="note">${note}</div>` : ''}
    </div>`;

  // ---------- home ----------
  const homeState = { q: '', sector: '', sort: 'payRatio', dir: -1, shown: 50 };

  async function renderHome() {
    document.title = 'Corner Office Math';
    let idx;
    try { idx = await getIndex(); } catch {
      app.innerHTML = '<p class="empty">The data has not been built yet. Run <code>node scripts/update-data.js</code>.</p>';
      return;
    }
    setUpdated(idx.updatedAt);
    const c = COLORS();
    const trend = idx.trend;
    const latest = [...trend].reverse().find(t => t.companies >= idx.companies.length * 0.6) || trend[trend.length - 1] || {};
    const sectors = [...new Set(idx.companies.map(x => x.sector).filter(Boolean))].sort();

    app.innerHTML = `
      <p class="eyebrow">S&amp;P 500 · fiscal years ${idx.firstYear}–${trend.length ? trend[trend.length - 1].year : ''}</p>
      <h1>CEO pay, employee pay and revenue, by company</h1>
      <p class="lede">Each year, public companies report what their CEO was paid, what their median employee was paid, and the ratio between the two. This site collects those figures from SEC filings, alongside each company's revenue, so you can look at them side by side and over time.</p>
      <div class="tiles">
        ${tile('Companies with data', int(idx.companies.filter(x => x.payRatio).length), `of ${int(idx.companies.length)} in the S&amp;P 500`)}
        ${tile(`Typical CEO pay, ${latest.year ?? ''}`, money(latest.ceoPay), 'Median across companies', c.ceo)}
        ${tile(`Typical median employee pay, ${latest.year ?? ''}`, money(latest.medianPay), 'Median across companies', c.median)}
        ${tile(`Typical pay ratio, ${latest.year ?? ''}`, ratio(latest.payRatio && latest.payRatio.median), 'CEO pay ÷ median employee pay')}
      </div>
      <div class="grid-2">
        <section class="card">
          <h2>Pay ratio across the S&amp;P 500</h2>
          <p class="sub">Middle company each year; the shaded band covers the middle half of companies.</p>
          <div class="legend"><span><i class="swatch" style="background:${c.ceo}"></i>Median ratio</span><span><i class="swatch" style="background:var(--band)"></i>25th–75th percentile</span></div>
          <div class="chart" id="trendRatio"></div>
        </section>
        <section class="card">
          <h2>Change in typical pay since ${trend[0] ? trend[0].year : ''}</h2>
          <p class="sub">Index, first year = 100. Typical = median across companies.</p>
          <div class="legend"><span><i class="swatch" style="background:${c.ceo}"></i>CEO pay</span><span><i class="swatch" style="background:${c.median}"></i>Median employee pay</span></div>
          <div class="chart" id="trendGrowth"></div>
        </section>
      </div>
      <section>
        <h2 style="margin:12px 0 10px">All companies</h2>
        <div class="toolbar">
          <input class="search" id="q" type="search" placeholder="Search company or ticker" value="${esc(homeState.q)}" aria-label="Search companies">
          <select class="select" id="sector" aria-label="Sector">
            <option value="">All sectors</option>
            ${sectors.map(s => `<option ${s === homeState.sector ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          </select>
          <span class="count" id="count"></span>
        </div>
        <div class="table-wrap"><table id="tbl"></table></div>
        <div class="more" id="more"></div>
      </section>`;

    Charts.lineChart(document.getElementById('trendRatio'), {
      label: 'Median CEO-to-median-employee pay ratio by year',
      series: [{ name: 'Median ratio', short: 'Median', color: c.ceo, values: trend.map(t => ({ x: t.year, y: t.payRatio.median })) }],
      band: trend.map(t => ({ x: t.year, lo: t.payRatio.p25, hi: t.payRatio.p75 })),
      yFormat: v => Math.round(v) + ':1',
      yMin: 0,
      tooltipExtra: x => {
        const t = trend.find(d => d.year === x);
        return `<div class="t-row"><span>Middle half</span><b>${ratio(t.payRatio.p25)} – ${ratio(t.payRatio.p75)}</b></div><div class="t-row"><span>Companies</span><b>${t.companies}</b></div>`;
      },
    });
    const base = trend[0] || {};
    Charts.lineChart(document.getElementById('trendGrowth'), {
      label: 'Typical CEO pay and median employee pay, indexed to the first year',
      series: [
        { name: 'CEO pay', color: c.ceo, values: trend.map(t => ({ x: t.year, y: base.ceoPay ? (t.ceoPay / base.ceoPay) * 100 : null })) },
        { name: 'Median employee pay', short: 'Employee pay', color: c.median, values: trend.map(t => ({ x: t.year, y: base.medianPay ? (t.medianPay / base.medianPay) * 100 : null })) },
      ],
      baseline: 100,
      yFormat: v => Math.round(v),
      tooltipExtra: x => {
        const t = trend.find(d => d.year === x);
        return `<div class="t-row"><span>CEO pay</span><b>${money(t.ceoPay)}</b></div><div class="t-row"><span>Employee pay</span><b>${money(t.medianPay)}</b></div>`;
      },
    });

    const cols = [
      { key: 'name', label: 'Company', left: true, get: r => r.name, cell: r => `<a class="co" href="/company/${encodeURIComponent(r.ticker)}" data-link>${esc(r.name)}</a><span class="tick">${esc(r.ticker)}</span>` },
      { key: 'sector', label: 'Sector', left: true, hideSm: true, get: r => r.sector || '', cell: r => `<span class="muted">${esc(r.sector || '')}</span>` },
      { key: 'year', label: 'Year', hideSm: true, get: r => r.year, cell: r => r.year ?? '–' },
      { key: 'ceoPay', label: 'CEO pay', get: r => r.ceoPay, cell: r => money(r.ceoPay) },
      { key: 'medianPay', label: 'Median employee pay', get: r => r.medianPay, cell: r => money(r.medianPay) },
      { key: 'payRatio', label: 'Pay ratio', get: r => r.payRatio, cell: r => ratio(r.payRatio) },
      { key: 'revenue', label: 'Revenue', hideSm: true, get: r => r.revenue, cell: r => money(r.revenue) },
      { key: 'revenuePerEmployee', label: 'Revenue per employee', hideSm: true, get: r => r.revenuePerEmployee, cell: r => money(r.revenuePerEmployee) },
      { key: 'ceoGrowth', label: 'CEO pay, yearly change', hideSm: true, get: r => r.ceoPayGrowth && r.ceoPayGrowth.perYear, cell: r => pct(r.ceoPayGrowth && r.ceoPayGrowth.perYear) },
      { key: 'medGrowth', label: 'Employee pay, yearly change', hideSm: true, get: r => r.medianPayGrowth && r.medianPayGrowth.perYear, cell: r => pct(r.medianPayGrowth && r.medianPayGrowth.perYear) },
    ];

    function drawTable() {
      const q = homeState.q.trim().toLowerCase();
      const col = cols.find(x => x.key === homeState.sort) || cols[5];
      let rows = idx.companies.filter(r =>
        (!q || r.name.toLowerCase().includes(q) || r.ticker.toLowerCase().includes(q)) &&
        (!homeState.sector || r.sector === homeState.sector));
      rows.sort((a, b) => {
        const va = col.get(a), vb = col.get(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * homeState.dir;
      });
      document.getElementById('count').textContent = `${rows.length} companies`;
      const shown = rows.slice(0, homeState.shown);
      document.getElementById('tbl').innerHTML = `
        <thead><tr>${cols.map(c => `<th class="${c.left ? 'left' : ''} ${c.hideSm ? 'hide-sm' : ''}"><button data-sort="${c.key}" aria-sort="${c.key === homeState.sort ? (homeState.dir > 0 ? 'ascending' : 'descending') : 'none'}">${c.label}</button></th>`).join('')}</tr></thead>
        <tbody>${shown.map(r => `<tr>${cols.map(c => `<td class="${c.left ? 'left' : 'num'} ${c.hideSm ? 'hide-sm' : ''}">${c.cell(r)}</td>`).join('')}</tr>`).join('')}</tbody>`;
      document.getElementById('more').innerHTML = rows.length > shown.length ? `<button class="btn" id="moreBtn">Show ${Math.min(100, rows.length - shown.length)} more</button>` : '';
    }
    drawTable();

    document.getElementById('q').addEventListener('input', e => { homeState.q = e.target.value; homeState.shown = 50; drawTable(); });
    document.getElementById('sector').addEventListener('change', e => { homeState.sector = e.target.value; homeState.shown = 50; drawTable(); });
    document.getElementById('tbl').addEventListener('click', e => {
      const b = e.target.closest('button[data-sort]');
      if (!b) return;
      const k = b.dataset.sort;
      if (homeState.sort === k) homeState.dir *= -1;
      else { homeState.sort = k; homeState.dir = (k === 'name' || k === 'sector') ? 1 : -1; }
      drawTable();
    });
    document.getElementById('more').addEventListener('click', e => {
      if (e.target.id === 'moreBtn') { homeState.shown += 100; drawTable(); }
    });
  }

  // ---------- company ----------
  async function renderCompany(ticker) {
    app.innerHTML = '<p class="loading">Loading…</p>';
    let co;
    try { co = await getCompany(ticker); } catch {
      app.innerHTML = `<p class="empty">No data for “${esc(ticker)}”. <a href="/" data-link>Back to all companies</a></p>`;
      return;
    }
    getIndex().then(i => setUpdated(i.updatedAt)).catch(() => {});
    document.title = `${co.name} · Corner Office Math`;
    const c = COLORS();
    const ys = co.years;
    const withPay = ys.filter(y => y.payRatio);
    const last = withPay[withPay.length - 1] || ys[ys.length - 1] || {};
    const lastRev = [...ys].reverse().find(y => y.revenuePerEmployee) || {};
    const pt = (key, y) => ({ x: y.year, y: y[key], estimated: y.source !== 'sec' });

    // Growth: each measure indexed to its own first available year.
    const indexed = key => {
      const first = ys.find(y => y[key] > 0);
      return ys.map(y => ({ x: y.year, y: first && y[key] > 0 ? (y[key] / first[key]) * 100 : null, estimated: y.source !== 'sec' }));
    };
    const firstYear = ys.length ? ys[0].year : '';

    app.innerHTML = `
      <a class="back" href="/" data-link>← All companies</a>
      <div class="co-head">
        <div>
          <p class="eyebrow" style="margin-top:14px">${esc(co.ticker)} · ${esc(co.sector || '')}</p>
          <h1>${esc(co.name)}</h1>
          <div class="co-meta">${esc(co.industry || '')}${co.headquarters ? ' · ' + esc(co.headquarters) : ''} · <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${co.cik}" target="_blank" rel="noopener">SEC filings</a></div>
        </div>
      </div>
      <div class="tiles">
        ${tile(`CEO pay, ${last.year ?? ''}`, money(last.ceoPay), 'Total compensation as reported', c.ceo)}
        ${tile(`Median employee pay, ${last.year ?? ''}`, money(last.medianPay), 'Total compensation as reported', c.median)}
        ${tile(`Pay ratio, ${last.year ?? ''}`, ratio(last.payRatio), 'CEO pay ÷ median employee pay')}
        ${tile(`Revenue per employee, ${lastRev.year ?? ''}`, money(lastRev.revenuePerEmployee), lastRev.revenuePerEmployeeToMedian ? `${lastRev.revenuePerEmployeeToMedian}× median employee pay` : '', c.revenue)}
      </div>
      <div class="grid-2">
        <section class="card">
          <h2>Pay ratio</h2>
          <p class="sub">CEO total pay divided by median employee total pay, as reported.</p>
          <div class="chart" id="cRatio"></div>
        </section>
        <section class="card">
          <h2>Change since ${firstYear}</h2>
          <p class="sub">Index, each measure's first year = 100.</p>
          <div class="legend">
            <span><i class="swatch" style="background:${c.ceo}"></i>CEO pay</span>
            <span><i class="swatch" style="background:${c.median}"></i>Median employee pay</span>
            <span><i class="swatch" style="background:${c.revenue}"></i>Revenue</span>
          </div>
          <div class="chart" id="cGrowth"></div>
        </section>
      </div>
      <section class="card">
        <h2>Revenue per employee and median employee pay</h2>
        <p class="sub">Revenue divided by reported head count, next to what the median employee was paid. Both in dollars per person.</p>
        <div class="legend">
          <span><i class="swatch" style="background:${c.revenue}"></i>Revenue per employee</span>
          <span><i class="swatch" style="background:${c.median}"></i>Median employee pay</span>
        </div>
        <div class="chart" id="cRpe"></div>
      </section>
      <section class="card">
        <h2>Year by year</h2>
        <p class="sub">Years are fiscal years, named for the calendar year they end in. Source links open the SEC filing.</p>
        <div class="table-wrap" style="border:0">
          <table>
            <thead><tr>
              <th>Year</th><th>CEO pay</th><th>Median employee pay</th><th>Pay ratio</th><th>Revenue</th><th>Employees</th><th>Revenue per employee</th><th class="left">Sources</th>
            </tr></thead>
            <tbody>${[...ys].reverse().map(y => `
              <tr class="${y.source !== 'sec' ? 'est' : ''}">
                <td class="left">${y.year}${y.source !== 'sec' ? ' (est.)' : ''}</td>
                <td class="num" title="${moneyFull(y.ceoPay)}">${money(y.ceoPay)}</td>
                <td class="num" title="${moneyFull(y.medianPay)}">${moneyFull(y.medianPay)}</td>
                <td class="num">${ratio(y.payRatio)}</td>
                <td class="num" title="${moneyFull(y.revenue)}">${money(y.revenue)}</td>
                <td class="num" title="${esc(sourceNote(y.employeesSource))}">${int(y.employees)}</td>
                <td class="num">${money(y.revenuePerEmployee)}</td>
                <td class="left">${[y.proxyUrl && `<a href="${esc(y.proxyUrl)}" target="_blank" rel="noopener">Proxy</a>`, y.tenKUrl && `<a href="${esc(y.tenKUrl)}" target="_blank" rel="noopener">10-K</a>`].filter(Boolean).join(' · ') || '<span class="muted">XBRL</span>'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>`;

    Charts.lineChart(document.getElementById('cRatio'), {
      label: `${co.name} pay ratio by year`,
      series: [{ name: 'Pay ratio', short: 'Ratio', color: c.ceo, values: ys.map(y => pt('payRatio', y)) }],
      yFormat: v => Math.round(v).toLocaleString('en-US') + ':1',
      yMin: 0,
      tooltipExtra: x => {
        const y = ys.find(d => d.year === x);
        return `<div class="t-row"><span>CEO pay</span><b>${money(y.ceoPay)}</b></div><div class="t-row"><span>Median employee</span><b>${money(y.medianPay)}</b></div>`;
      },
    });
    Charts.lineChart(document.getElementById('cGrowth'), {
      label: `${co.name} CEO pay, median employee pay and revenue, indexed`,
      series: [
        { name: 'CEO pay', color: c.ceo, values: indexed('ceoPay') },
        { name: 'Median employee pay', short: 'Employee pay', color: c.median, values: indexed('medianPay') },
        { name: 'Revenue', color: c.revenue, values: indexed('revenue') },
      ],
      baseline: 100,
      yFormat: v => Math.round(v),
      tooltipExtra: x => {
        const y = ys.find(d => d.year === x);
        return `<div class="t-row"><span>Actual CEO pay</span><b>${money(y.ceoPay)}</b></div><div class="t-row"><span>Actual employee pay</span><b>${money(y.medianPay)}</b></div><div class="t-row"><span>Actual revenue</span><b>${money(y.revenue)}</b></div>`;
      },
    });
    Charts.lineChart(document.getElementById('cRpe'), {
      label: `${co.name} revenue per employee and median employee pay`,
      series: [
        { name: 'Revenue per employee', short: 'Revenue/employee', color: c.revenue, values: ys.map(y => pt('revenuePerEmployee', y)) },
        { name: 'Median employee pay', short: 'Employee pay', color: c.median, values: ys.map(y => pt('medianPay', y)) },
      ],
      yFormat: money,
      yMin: 0,
      height: 240,
      tooltipExtra: x => {
        const y = ys.find(d => d.year === x);
        return y.revenuePerEmployeeToMedian ? `<div class="t-row"><span>Ratio</span><b>${y.revenuePerEmployeeToMedian}×</b></div>` : '';
      },
    });
  }

  function sourceNote(s) {
    return { proxy: 'Head count from the proxy statement', xbrl: 'Head count tagged in the 10-K', '10-K': 'Head count from the 10-K text' }[s] || '';
  }

  // ---------- about ----------
  function renderAbout() {
    document.title = 'About the data · Corner Office Math';
    app.innerHTML = `
      <div class="prose">
        <p class="eyebrow">About the data</p>
        <h1>Where the numbers come from</h1>
        <p class="lede">Every figure on this site is read from public filings in the SEC's EDGAR system. Nothing is adjusted, and each year links back to the filing it came from.</p>

        <h2>CEO pay, median employee pay and the pay ratio</h2>
        <p>Since 2018, U.S. public companies have had to disclose in their annual proxy statement (form DEF 14A) the total pay of their CEO, the total pay of their median employee, and the ratio between the two (Item 402(u) of Regulation S-K). We take all three from that disclosure.</p>
        <ul>
          <li>We only keep a result when CEO pay divided by median pay matches the ratio the company states, allowing for rounding. That check guards against picking up the wrong number.</li>
          <li>When a company does not repeat the CEO's pay in that paragraph, we use the ratio and median pay it reports, and the CEO total from its tagged Pay Versus Performance table where available.</li>
          <li>Companies choose their own method for finding the median employee (for example, which date they count staff on, and whether they leave out some non-U.S. workers). Some annualize pay for a CEO who joined mid-year. We report what each company reports.</li>
        </ul>

        <h2>Revenue</h2>
        <p>Annual revenue comes from the tagged financial statements (XBRL "company facts") in each 10-K. Companies use different revenue tags by industry; for each year we use the largest reported total revenue figure.</p>

        <h2>Employees and revenue per employee</h2>
        <p>Head count comes from the proxy's pay ratio disclosure when it states one, otherwise from the 10-K (tagged, or the "Human Capital" section). Revenue per employee is revenue divided by that head count. It is a rough measure: head counts are taken on one day, and some include part-time and seasonal staff.</p>

        <h2>Years</h2>
        <p>Years are fiscal years, named for the calendar year in which they end. A fiscal year ending in January 2025 is shown as 2025.</p>

        <h2>Which companies</h2>
        <p>Companies in the S&amp;P 500 today. A company that joined the index recently still shows its earlier years.</p>

        <h2>Years before 2018</h2>
        <p>Companies were not required to report median employee pay before 2018. When earlier years are added, median pay for those years will be an estimate based on Bureau of Labor Statistics wages for the company's industry. Estimates will be clearly marked: dashed lines and hollow dots in charts, and "(est.)" in tables.</p>

        <h2>Updates</h2>
        <p>The data is refreshed automatically each week from EDGAR. Most proxy statements are filed between February and May.</p>
      </div>`;
  }

  function setUpdated(iso) {
    if (!iso) return;
    document.getElementById('updated').textContent = 'Data last updated ' + new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + '.';
  }

  // Redraw charts if the color scheme changes.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  render();
})();
