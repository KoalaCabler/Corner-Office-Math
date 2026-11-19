#!/usr/bin/env node
// Builds the site's data from SEC EDGAR.
//
//   SEC_USER_AGENT="CEO Pay Gap you@example.com" node scripts/update-data.js
//
// Options:
//   --only AAPL,MSFT     just these tickers
//   --limit 20           just the first N companies
//   --budget-minutes 300 stop cleanly after this long (the next run picks up where it left off)
//   --refetch            ignore the cache and re-read every filing
//   --rebuild            only rebuild the output files from the cache (no network)
//
// For every S&P 500 company it reads:
//   - company facts (XBRL): annual revenue, plus tagged head counts and CEO pay where present
//   - each proxy statement (DEF 14A) filed since 2018: the CEO pay ratio disclosure,
//     which gives CEO total pay, median employee pay and the ratio
//   - the matching 10-K, only when the head count is not available elsewhere
//
// Parsed filings are cached in data/cache/<cik>.json, so later runs only read new filings.

const fs = require('fs');
const path = require('path');
const edgar = require('./lib/edgar');
const { htmlToText } = require('./lib/text');
const { parsePayRatio, parseEmployees10K } = require('./lib/pay-ratio');
const { revenueByYear, employeesByAccession, ceoPayByYear, yearOf } = require('./lib/facts');
const { loadSp500 } = require('./lib/sp500');
const { buildCompany, buildIndex } = require('./lib/build');

// Bump when a parser changes, so cached results get re-parsed.
const PARSER_VERSION = 2;
const FIRST_YEAR = 2018;
const SINCE = '2018-01-01'; // first proxies with a pay ratio were filed in early 2018 (fiscal 2017)

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CACHE = path.join(DATA, 'cache');
const OUT = path.join(DATA, 'companies');

const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf('--' + name);
  return i < 0 ? undefined : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true);
};
const ONLY = opt('only') ? String(opt('only')).toUpperCase().split(',') : null;
const LIMIT = opt('limit') ? Number(opt('limit')) : Infinity;
const BUDGET_MS = (Number(opt('budget-minutes')) || 24 * 60) * 60000;
const REFETCH = !!opt('refetch');
const REBUILD_ONLY = !!opt('rebuild');
const CONCURRENCY = 4;
const PREDECESSORS = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'predecessors.json'), 'utf8')).companies || {}; } catch { return {}; }
})();

const started = Date.now();
const fileSafe = t => t.replace(/[^A-Z0-9-]/gi, '-');

function readCache(cik) {
  const f = path.join(CACHE, `${cik}.json`);
  if (!fs.existsSync(f)) return { proxies: {}, tenKs: {} };
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { proxies: c.proxies || {}, tenKs: c.tenKs || {}, facts: c.facts, filings: c.filings };
}

function writeCache(cik, cache) {
  fs.writeFileSync(path.join(CACHE, `${cik}.json`), JSON.stringify(cache, null, 1));
}

// Which fiscal year does a proxy report on? The one covered by the latest
// 10-K filed before it.
function fiscalPeriodFor(proxy, tenKs) {
  const prior = tenKs.filter(k => k.filingDate <= proxy.filingDate && k.reportDate);
  if (!prior.length) return null;
  const k = prior[0]; // newest first
  const monthsApart = (Date.parse(proxy.filingDate) - Date.parse(k.reportDate)) / (30.4 * 86400000);
  return monthsApart <= 15 ? k : null;
}

async function processCompany(co) {
  const cache = readCache(co.cik);

  if (!REBUILD_ONLY) {
    // A company that moved to a new holding company (a new CIK) keeps its
    // earlier filings under the old one; data/predecessors.json links them.
    const ciks = [co.cik, ...(PREDECESSORS[co.ticker] || [])];
    let filings = [];
    const factsList = [];
    for (const cik of ciks) {
      const [f, facts] = await Promise.all([edgar.filings(cik, '2017-01-01'), edgar.companyFacts(cik)]);
      filings = filings.concat(f.map(x => ({ ...x, cik })));
      factsList.push(facts);
    }
    filings.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
    const proxies = filings.filter(f => f.form === 'DEF 14A' && f.filingDate >= SINCE);
    const tenKs = filings.filter(f => /^10-K(T)?$/.test(f.form));

    for (const p of proxies) {
      const hit = cache.proxies[p.accession];
      if (hit && hit.parserVersion === PARSER_VERSION && !REFETCH) continue;
      let url = edgar.documentUrl(p.cik, p);
      let parsed = null;
      try {
        const html = await edgar.getText(url);
        parsed = html ? parsePayRatio(htmlToText(html)) : null;
        if (!parsed) {
          // Try the filing's other documents (up to three, largest first).
          for (const other of (await edgar.otherDocuments(p.cik, p)).slice(0, 3)) {
            const h = await edgar.getText(other);
            parsed = h ? parsePayRatio(htmlToText(h)) : null;
            if (parsed) { url = other; break; }
          }
        }
      } catch (err) {
        console.warn(`  ${co.ticker} proxy ${p.accession}: ${err.message}`);
        continue; // leave uncached so the next run retries it
      }
      const k = fiscalPeriodFor(p, tenKs);
      cache.proxies[p.accession] = {
        parserVersion: PARSER_VERSION,
        filingDate: p.filingDate,
        url,
        periodEnd: k ? k.reportDate : null,
        tenK: k ? k.accession : null,
        result: parsed,
      };
    }

    // Compact copies of what we need from the (large) facts file.
    // (Oldest CIK first, so the current company's figures win on overlap.)
    const merged = { revenue: {}, employeesTagged: {}, ceoPayPvp: {} };
    for (const facts of [...factsList].reverse()) {
      Object.assign(merged.revenue, revenueByYear(facts));
      Object.assign(merged.employeesTagged, employeesByAccession(facts));
      Object.assign(merged.ceoPayPvp, ceoPayByYear(facts));
    }
    cache.facts = merged;
    cache.filings = { tenKs: tenKs.map(k => ({ accession: k.accession, filingDate: k.filingDate, reportDate: k.reportDate, url: edgar.documentUrl(k.cik, k) })) };

    // Head counts: the proxy, then tagged XBRL, then the 10-K text.
    const years = assembleYears(co, cache);
    for (const y of years) {
      if (y.employees || !y.tenK || !y.revenue) continue;
      const k = cache.filings.tenKs.find(t => t.accession === y.tenK);
      if (!k || (cache.tenKs[k.accession] && cache.tenKs[k.accession].parserVersion === PARSER_VERSION && !REFETCH)) continue;
      try {
        const html = await edgar.getTextUntil(k.url, t => parseEmployees10K(htmlToText(t)) !== null);
        cache.tenKs[k.accession] = { parserVersion: PARSER_VERSION, employees: html ? parseEmployees10K(htmlToText(html)) : null };
      } catch (err) {
        console.warn(`  ${co.ticker} 10-K ${k.accession}: ${err.message}`);
      }
    }
    writeCache(co.cik, cache);
  }

  if (!cache.facts) return null;
  const company = buildCompany(co, assembleYears(co, cache));
  fs.writeFileSync(path.join(OUT, `${fileSafe(co.ticker)}.json`), JSON.stringify(company));
  return company;
}

// Regex-found head counts are sometimes a subgroup ("250 employees in
// Ireland"). Reject counts that would make revenue per employee absurd
// compared with what the median employee is paid.
function plausibleEmployees(n, revenue, medianPay) {
  if (!n || n < 100) return false;
  if (revenue && n < 1000 && revenue > 5e9) return false;
  if (revenue && medianPay) {
    const x = revenue / n / medianPay;
    if (x > 150 || x < 0.3) return false;
  }
  return true;
}

// Merge revenue, pay ratio and head count into one row per fiscal year.
function assembleYears(co, cache) {
  const rows = {};
  const row = y => (rows[y] = rows[y] || { year: Number(y) });
  const tenKByPeriod = {};
  for (const k of (cache.filings && cache.filings.tenKs) || []) if (k.reportDate && !tenKByPeriod[k.reportDate]) tenKByPeriod[k.reportDate] = k;

  for (const [y, r] of Object.entries(cache.facts.revenue || {})) {
    if (y < FIRST_YEAR - 1) continue;
    Object.assign(row(y), { revenue: r.revenue, revenueTag: r.revenueTag, periodEnd: r.periodEnd, revenueAccession: r.accession });
  }

  // One proxy per year: prefer a fully cross-checked parse, then the earliest
  // filed (the annual meeting proxy, not a later special-meeting one).
  const proxies = Object.entries(cache.proxies)
    .map(([accession, p]) => ({ accession, ...p }))
    .filter(p => p.result)
    .sort((a, b) => (a.result.method === 'cross-checked' ? 0 : 1) - (b.result.method === 'cross-checked' ? 0 : 1) || a.filingDate.localeCompare(b.filingDate));
  const used = new Set();
  for (const p of proxies) {
    const y = p.periodEnd ? yearOf(p.periodEnd) : (p.result.statedYear || Number(p.filingDate.slice(0, 4)) - 1);
    if (used.has(y) || y < FIRST_YEAR - 1) continue;
    used.add(y);
    const r = row(y);
    Object.assign(r, {
      ceoPay: p.result.ceoPay,
      medianPay: p.result.medianPay,
      payRatio: p.result.payRatio,
      payMethod: p.result.method,
      proxyUrl: p.url,
      proxyFiled: p.filingDate,
      tenK: p.tenK,
    });
    if (!r.periodEnd && p.periodEnd) r.periodEnd = p.periodEnd;
    r.proxyEmployees = p.result.employees;
  }

  for (const r of Object.values(rows)) {
    const pvp = cache.facts.ceoPayPvp && cache.facts.ceoPayPvp[r.year];
    if (pvp) {
      r.ceoPaySct = pvp;
      if (!r.ceoPay) { r.ceoPay = pvp; r.ceoPaySource = 'pay-versus-performance'; }
    }
    if (!r.tenK && r.periodEnd && tenKByPeriod[r.periodEnd]) r.tenK = tenKByPeriod[r.periodEnd].accession;
    // Head count: first plausible figure from the proxy, tagged XBRL, then 10-K text.
    const candidates = [
      [r.proxyEmployees, 'proxy'],
      [r.tenK && cache.facts.employeesTagged && cache.facts.employeesTagged[r.tenK], 'xbrl'],
      [r.tenK && cache.tenKs[r.tenK] && cache.tenKs[r.tenK].employees, '10-K'],
    ];
    const pick = candidates.find(([n]) => plausibleEmployees(n, r.revenue, r.medianPay));
    if (pick) Object.assign(r, { employees: pick[0], employeesSource: pick[1] });
    delete r.proxyEmployees;
    if (r.tenK) {
      const k = ((cache.filings && cache.filings.tenKs) || []).find(t => t.accession === r.tenK);
      if (k) r.tenKUrl = k.url;
    }
  }
  return Object.values(rows).sort((a, b) => a.year - b.year);
}

async function main() {
  if (!REBUILD_ONLY) edgar.requireUA();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  let list = await loadSp500({ refresh: !REBUILD_ONLY && !ONLY });
  if (ONLY) list = list.filter(c => ONLY.includes(c.ticker.toUpperCase()));
  list = list.slice(0, LIMIT);

  // Companies with the oldest (or no) cache go first, so a time-limited run
  // keeps making progress across runs.
  const age = c => {
    const f = path.join(CACHE, `${c.cik}.json`);
    return fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0;
  };
  const queue = [...list].sort((a, b) => age(a) - age(b));
  console.log(`${queue.length} companies to update${REBUILD_ONLY ? ' (rebuild only)' : ''}`);

  let done = 0;
  let stoppedEarly = false;
  async function worker() {
    while (queue.length) {
      if (Date.now() - started > BUDGET_MS) { stoppedEarly = true; return; }
      const co = queue.shift();
      try {
        const c = await processCompany(co);
        done++;
        const last = c && c.years.filter(y => y.payRatio).slice(-1)[0];
        console.log(`[${done}/${list.length}] ${co.ticker.padEnd(6)} ${last ? `${last.year} ratio ${last.payRatio}:1, median $${Math.round(last.medianPay).toLocaleString()}` : 'no pay ratio found'}`);
      } catch (err) {
        console.error(`[error] ${co.ticker}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: REBUILD_ONLY ? 1 : CONCURRENCY }, worker));

  // The index always covers every company with a built file, not just this run's.
  const sp = await loadSp500({ refresh: false });
  const companies = sp
    .map(c => path.join(OUT, `${fileSafe(c.ticker)}.json`))
    .filter(f => fs.existsSync(f))
    .map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
  const index = buildIndex(companies);
  fs.writeFileSync(path.join(DATA, 'index.json'), JSON.stringify(index));
  console.log(`Wrote ${companies.length} companies.${stoppedEarly ? ' Stopped at the time budget; run again to continue.' : ''}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
