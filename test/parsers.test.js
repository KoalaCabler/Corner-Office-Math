// Run: npm test
// Snippets below are shortened from real proxy statements, to cover the
// different ways companies word the pay ratio disclosure.
const test = require('node:test');
const assert = require('node:assert');
const { parsePayRatio, parseEmployees10K } = require('../scripts/lib/pay-ratio');
const { htmlToText } = require('../scripts/lib/text');
const { revenueByYear } = require('../scripts/lib/facts');

test('plain sentence (Apple style)', () => {
  const t = 'CEO Pay Ratio 2020 The 2020 annual total compensation of our CEO was $14,769,259, the 2020 annual total compensation of our median compensated employee was $57,783, and the ratio of these amounts was 256 to 1.';
  const r = parsePayRatio(t);
  assert.deepStrictEqual([r.ceoPay, r.medianPay, r.payRatio, r.method], [14769259, 57783, 256, 'cross-checked']);
});

test('table layout split across cells (Bank of America style)', () => {
  const html = '<p>CEO pay ratio</p><table><tr><td>CEO annual total compensation*</td><td>$</td><td>33,720,446</td></tr><tr><td>Median employee annual total compensation</td><td>$</td><td>123,990</td></tr><tr><td>CEO to median employee pay ratio</td><td>272:1</td></tr></table>';
  const r = parsePayRatio(htmlToText(html));
  assert.deepStrictEqual([r.ceoPay, r.medianPay, r.payRatio], [33720446, 123990, 272]);
});

test('inverted "1-to-N" wording (Amazon style)', () => {
  const t = "Pay Ratio Disclosure The 2024 annual total compensation of our median compensated employee was $37,181; Mr. Jassy's 2024 annual total compensation as reported under SEC rules was $1,596,889, resulting in a ratio of those amounts of 1-to-43.";
  const r = parsePayRatio(t);
  assert.deepStrictEqual([r.ceoPay, r.medianPay, r.payRatio], [1596889, 37181, 43]);
});

test('ignores ratios quoted inside a shareholder proposal', () => {
  const proposal = 'Shareholder Proposal. Supporting Statement: In 2018, the four NEOs pay ratios to the median compensated employee pay are larger than 478 to 1 ($26,509,692 to $55,426, Ibid. p.41).';
  const filler = ' Other business of the meeting. '.repeat(150);
  const own = 'CEO Pay Ratio The annual total compensation of our CEO was $14,769,259, the annual total compensation of our median compensated employee was $57,783, and the ratio of these amounts was 256 to 1.';
  const r = parsePayRatio(own + filler + proposal);
  assert.strictEqual(r.payRatio, 256);
});

test('dollar amounts in millions', () => {
  const t = 'Pay Ratio. Our CEO total compensation was $12.5 million and the median employee annual total compensation was $62,500. The pay ratio is 200:1.';
  const r = parsePayRatio(t);
  assert.deepStrictEqual([r.ceoPay, r.medianPay, r.payRatio], [12.5e6, 62500, 200]);
});

test('ratio and median only, CEO total elsewhere', () => {
  const t = 'CEO Pay Ratio. The annual total compensation of our median employee was $71,234. Our CEO pay ratio for 2023 was 310 to 1, using the total reported in the Summary Compensation Table.';
  const r = parsePayRatio(t);
  assert.deepStrictEqual([r.ceoPay, r.medianPay, r.payRatio, r.method], [null, 71234, 310, 'ratio-and-median']);
});

test('returns null when there is no disclosure', () => {
  assert.strictEqual(parsePayRatio('Notice of annual meeting. Please vote your shares.'), null);
});

test('employee count from the pay ratio section', () => {
  const t = 'Pay ratio. As of October 1, our employee population consisted of approximately 2,100,000 individuals worldwide. The median employee annual total compensation was $27,642 and our CEO was paid $26,968,924, a ratio of 976 to 1.';
  assert.strictEqual(parsePayRatio(t).employees, 2100000);
});

test('employee count from a 10-K human capital section', () => {
  const t = 'Item 1. Business\nHuman Capital\nAs of December 31, 2023, we had approximately 161,000 full-time employees worldwide.';
  assert.strictEqual(parseEmployees10K(t), 161000);
});

test('revenue: banks use net revenue, not gross interest income', () => {
  const f = (val, end, tag) => ({ val, start: `${end.slice(0, 4)}-01-01`, end, form: '10-K', filed: `${Number(end.slice(0, 4)) + 1}-02-20`, accn: 'x' });
  const facts = { facts: { 'us-gaap': {
    InterestAndDividendIncomeOperating: { units: { USD: [f(146e9, '2024-12-31')] } },
    RevenuesNetOfInterestExpense: { units: { USD: [f(101e9, '2024-12-31')] } },
  } } };
  assert.strictEqual(revenueByYear(facts)[2024].revenue, 101e9);
});

test('revenue: largest general tag wins, restatements replace originals', () => {
  const facts = { facts: { 'us-gaap': {
    Revenues: { units: { USD: [
      { val: 100, start: '2023-01-01', end: '2023-12-31', form: '10-K', filed: '2024-02-01', accn: 'a' },
      { val: 105, start: '2023-01-01', end: '2023-12-31', form: '10-K', filed: '2025-02-01', accn: 'b' },
    ] } },
    SalesRevenueGoodsNet: { units: { USD: [{ val: 60, start: '2023-01-01', end: '2023-12-31', form: '10-K', filed: '2024-02-01', accn: 'a' }] } },
  } } };
  assert.strictEqual(revenueByYear(facts)[2023].revenue, 105);
});

test('decimal ratio with thousands separator, and a supplemental ratio after it (Tesla 2018)', () => {
  const t = 'Pay Ratio Disclosure. Mr. Musk\'s 2018 annual total compensation, as reported in the Summary Compensation Table, was $ 2,284,044,884 , and the median 2018 annual total compensation of all other employees was $56,163. Consequently, the applicable ratio of such amounts for 2018 was 40,668.14:1. However, using the "Total CEO realized compensation" for 2018 of $56,380, such ratio was 1.00:1.';
  const r = parsePayRatio(t);
  assert.deepStrictEqual([r.ceoPay, r.medianPay, r.payRatio], [2284044884, 56163, 40668.14]);
});

test('CEO paid nothing (ratio 0:1)', () => {
  const t = "Pay Ratio Disclosure. Mr. Musk's 2023 annual total compensation, as reported in the Summary Compensation Table, was $0, and the median 2023 annual total compensation of all other qualifying employees was $45,811. Consequently, the applicable ratio of such amounts for 2023 was 0.00:1.";
  const r = parsePayRatio(t);
  assert.deepStrictEqual([r.ceoPay, r.medianPay, r.payRatio], [0, 45811, 0]);
});

test('bare ratio number in a sentence (Marsh McLennan style)', () => {
  const t = 'CEO Pay Ratio. The ratio of the annual total compensation for our CEO compared to the median of the annual total compensation of all of our employees for 2025 is 330. The ratio is based on the following: Median employee: | $76,092 | CEO: | $25,051,051 |';
  const r = parsePayRatio(t);
  assert.deepStrictEqual([r.ceoPay, r.medianPay, r.payRatio], [25051051, 76092, 330]);
});

test('bare ratio in a table cell (Charter style)', () => {
  const html = '<p>pay ratio</p><table><tr><td>CEO Total Annual Compensation</td><td>$6,466,193</td></tr><tr><td>Median Employee Total Annual Compensation</td><td>$ 79,159</td></tr><tr><td>Ratio of CEO to Median Employee Total Annual Compensation</td><td>81.7</td></tr></table>';
  const r = parsePayRatio(htmlToText(html));
  assert.deepStrictEqual([r.ceoPay, r.medianPay, r.payRatio], [6466193, 79159, 81.7]);
});

test('token CEO pay far below the median (Block style)', () => {
  const t = 'PAY RATIO DISCLOSURE. For 2025: the median of the annual total compensation of all our employees was $222,772; and the annual total compensation of our Block Head, as reported in the Summary Compensation Table, was $2.75. Based on this information, the annual total compensation of our Block Head was less than 0.00001 times that of the median.';
  const r = parsePayRatio(t);
  assert.deepStrictEqual([r.ceoPay, r.medianPay, r.payRatio], [2.75, 222772, 0.00001]);
});

test('component rows in a pay table do not beat the totals (Church & Dwight style)', () => {
  const t = 'Our 2024 CEO to median employee pay ratio is 157.1:1. | CEO to Median Employee Pay Ratio | President and CEO | Median Employee | Base Salary | $ | 1,231,633 | $ | 65,938 | Annual Incentive | 2,499,000 | 3,930 | Total | $ | 10,965,000 | $ | 69,796 |';
  const r = parsePayRatio(t);
  assert.strictEqual(r.payRatio, 157.1);
  assert.ok(r.medianPay < 700000);
});

test('revenue: bank with no revenue tag uses net interest income + noninterest income', () => {
  const f = val => ({ val, start: '2025-01-01', end: '2025-12-31', form: '10-K', filed: '2026-02-10', accn: 'x' });
  const facts = { facts: { 'us-gaap': {
    InterestIncomeExpenseNet: { units: { USD: [f(18466e6)] } },
    NoninterestIncome: { units: { USD: [f(520e6)] } },
  } } };
  assert.strictEqual(revenueByYear(facts)[2025].revenue, 18986e6);
});
