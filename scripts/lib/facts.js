// Pulls annual revenue (and, where tagged, employee counts and the CEO's
// Summary Compensation Table total) out of an EDGAR "company facts" file.

// Revenue is tagged differently by industry. For each fiscal year we take
// the largest figure among the general revenue tags, since a sub-line (e.g.
// "goods" revenue) is always smaller than total revenue.
const REVENUE_TAGS = [
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'SalesRevenueNet',
  'SalesRevenueGoodsNet',
  'SalesRevenueServicesNet',
  'RegulatedAndUnregulatedOperatingRevenue',
  'ElectricUtilityRevenue',
  'RealEstateRevenueNet',
  'OperatingLeasesIncomeStatementLeaseRevenue',
  'HealthCareOrganizationRevenue',
  'TotalRevenuesAndOtherIncome',
];
// Banks report "total net revenue" (net of interest expense). When a company
// tags it, it wins over the general tags, whose largest value for a bank can
// be gross interest income instead of revenue.
const BANK_TAG = 'RevenuesNetOfInterestExpense';
// Last resort only, when nothing else is tagged.
const FALLBACK_TAGS = ['InterestAndDividendIncomeOperating'];

const DAY = 86400000;

// We file every number under the calendar year its fiscal year ends in.
// (Walmart's year ending January 2024 is 2024; Apple's ending September 2024 is 2024.)
const yearOf = endDate => Number(endDate.slice(0, 4));

function annual(fact) {
  if (!fact.start || !fact.end) return false;
  const days = (Date.parse(fact.end) - Date.parse(fact.start)) / DAY;
  return days >= 340 && days <= 380;
}

function latestByPeriod(gaap, tag) {
  const usd = gaap[tag] && gaap[tag].units && gaap[tag].units.USD;
  if (!usd) return [];
  // Latest filing wins for each period, so restatements replace originals.
  const byPeriod = {};
  for (const f of usd) {
    if (!/^10-K/.test(f.form) || !annual(f)) continue;
    if (!byPeriod[f.end] || f.filed > byPeriod[f.end].filed) byPeriod[f.end] = f;
  }
  return Object.values(byPeriod);
}

function revenueByYear(facts) {
  const gaap = (facts && facts.facts && facts.facts['us-gaap']) || {};
  const pick = tags => {
    const byYear = {};
    for (const tag of tags) {
      for (const f of latestByPeriod(gaap, tag)) {
        const y = yearOf(f.end);
        const cur = byYear[y];
        // Prefer the latest period ending in that year (fiscal year changes),
        // then the largest revenue figure across tags.
        if (!cur || f.end > cur.periodEnd || (f.end === cur.periodEnd && f.val > cur.revenue)) {
          byYear[y] = { revenue: f.val, periodEnd: f.end, revenueTag: tag, accession: f.accn };
        }
      }
    }
    return byYear;
  };
  return { ...pick(FALLBACK_TAGS), ...pick(REVENUE_TAGS), ...pick([BANK_TAG]) };
}

// Few companies tag their head count, and the tag is dated at the cover page,
// so we key it by the 10-K's accession number and match it to a year later.
function employeesByAccession(facts) {
  const dei = (facts && facts.facts && facts.facts.dei) || {};
  const out = {};
  const units = dei.EntityNumberOfEmployees && dei.EntityNumberOfEmployees.units;
  if (!units) return out;
  for (const list of Object.values(units)) {
    for (const f of list) if (/^10-K/.test(f.form) && f.accn) out[f.accn] = f.val;
  }
  return out;
}

// Pay versus Performance tables (proxies filed from 2023 on) are tagged in
// XBRL and repeat the CEO's Summary Compensation Table total for up to five
// years. When the company-facts file carries them, they confirm our parse.
function ceoPayByYear(facts) {
  const ecd = (facts && facts.facts && facts.facts.ecd) || {};
  const out = {};
  const tag = ecd.PeoTotalCompAmt && ecd.PeoTotalCompAmt.units && ecd.PeoTotalCompAmt.units.USD;
  if (!tag) return out;
  for (const f of tag) {
    if (!f.end) continue;
    const y = yearOf(f.end);
    if (!out[y] || f.filed > out[y].filed) out[y] = { val: f.val, filed: f.filed };
  }
  return Object.fromEntries(Object.entries(out).map(([y, v]) => [y, v.val]));
}

module.exports = { revenueByYear, employeesByAccession, ceoPayByYear, yearOf };
