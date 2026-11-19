// Shapes the per-company files and the site-wide index.
//
// Every yearly row carries `source`. Today that is always "sec" (numbers read
// from SEC filings). Years before 2018 will be added later with
// source "bls-estimate": the median worker's pay estimated from Bureau of
// Labor Statistics industry wages, because companies did not disclose it.
// The site draws estimated values differently and labels them, so keep the
// flag on every row.

const FIRST_YEAR = 2018;

const round = (n, d = 0) => (n == null || !isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

function buildCompany(co, years) {
  const rows = years
    .filter(y => y.year >= FIRST_YEAR)
    .map(y => {
      const revenuePerEmployee = y.revenue && y.employees ? y.revenue / y.employees : null;
      return {
        year: y.year,
        source: 'sec',
        periodEnd: y.periodEnd || null,
        revenue: y.revenue ?? null,
        revenueTag: y.revenueTag || null,
        employees: y.employees ?? null,
        employeesSource: y.employeesSource || null,
        ceoPay: round(y.ceoPay),
        ceoPaySct: round(y.ceoPaySct),
        medianPay: round(y.medianPay),
        payRatio: y.payRatio ?? null,
        payMethod: y.payMethod || y.ceoPaySource || null,
        revenuePerEmployee: round(revenuePerEmployee),
        revenuePerEmployeeToMedian: revenuePerEmployee && y.medianPay ? round(revenuePerEmployee / y.medianPay, 1) : null,
        proxyUrl: y.proxyUrl || null,
        tenKUrl: y.tenKUrl || null,
      };
    })
    .filter(r => r.revenue || r.payRatio || r.ceoPay);

  return {
    ticker: co.ticker,
    name: co.name,
    cik: co.cik,
    sector: co.sector,
    industry: co.industry,
    headquarters: co.headquarters,
    years: rows,
  };
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Compound annual growth between the first and last years that both have a value.
function growth(rows, key) {
  const pts = rows.filter(r => r[key] > 0);
  if (pts.length < 2) return null;
  const a = pts[0], b = pts[pts.length - 1];
  if (b.year === a.year) return null;
  return { from: a.year, to: b.year, total: round(b[key] / a[key] - 1, 4), perYear: round((b[key] / a[key]) ** (1 / (b.year - a.year)) - 1, 4) };
}

function buildIndex(companies) {
  const list = companies.map(c => {
    const withRatio = c.years.filter(y => y.payRatio);
    const latest = withRatio[withRatio.length - 1] || c.years[c.years.length - 1] || {};
    return {
      ticker: c.ticker,
      name: c.name,
      sector: c.sector,
      year: latest.year ?? null,
      payRatio: latest.payRatio ?? null,
      ceoPay: latest.ceoPay ?? null,
      medianPay: latest.medianPay ?? null,
      revenue: latest.revenue ?? null,
      revenuePerEmployee: latest.revenuePerEmployee ?? null,
      ceoPayGrowth: growth(c.years, 'ceoPay'),
      medianPayGrowth: growth(c.years, 'medianPay'),
      revenueGrowth: growth(c.years, 'revenue'),
      yearsCovered: c.years.filter(y => y.payRatio).length,
    };
  });

  // Across all companies, year by year.
  const years = [...new Set(companies.flatMap(c => c.years.map(y => y.year)))].sort();
  const trend = years.map(year => {
    const rows = companies.map(c => c.years.find(y => y.year === year)).filter(Boolean);
    const sortedBy = k => rows.map(r => r[k]).filter(v => v > 0).sort((a, b) => a - b);
    const ratio = sortedBy('payRatio'), ceo = sortedBy('ceoPay'), med = sortedBy('medianPay');
    return {
      year,
      companies: ratio.length,
      payRatio: { p25: round(quantile(ratio, 0.25)), median: round(quantile(ratio, 0.5)), p75: round(quantile(ratio, 0.75)) },
      ceoPay: round(quantile(ceo, 0.5)),
      medianPay: round(quantile(med, 0.5)),
    };
  }).filter(t => t.companies >= 20);

  return { updatedAt: new Date().toISOString(), firstYear: FIRST_YEAR, companies: list, trend };
}

module.exports = { buildCompany, buildIndex, growth };
