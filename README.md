# Corner Office Math

CEO pay, median employee pay and revenue for S&P 500 companies, year by year, taken from SEC filings.

## What it shows

- **Company list**: every S&P 500 company with its latest CEO pay, median employee pay, pay ratio, revenue, revenue per employee, and yearly change in pay. Search, filter by sector, sort by any column.
- **Across the S&P 500**: the typical (median) pay ratio each year with the middle half of companies shaded, and how typical CEO pay and median employee pay changed since 2018.
- **Company page**: pay ratio over time; CEO pay, median employee pay and revenue indexed to the first year; revenue per employee next to median employee pay; and a year-by-year table where every row links to the SEC filing it came from.
- **About the data**: how each number is found, in plain language.

Figures are shown as reported. The site does not rank companies as good or bad.

## Where the data comes from

All from SEC EDGAR, no other sources:

| Figure | Source |
|---|---|
| Revenue | XBRL "company facts" from each 10-K (`data.sec.gov/api/xbrl/companyfacts`) |
| CEO total pay, median employee pay, pay ratio | The CEO pay ratio disclosure in each proxy statement (DEF 14A), required since 2018 |
| CEO total pay (backup) | The tagged Pay Versus Performance table, when the pay ratio paragraph doesn't repeat it |
| Employees | The pay ratio disclosure, else the 10-K (tagged, or its Human Capital section) |
| Company list | Wikipedia's "List of S&P 500 companies" (ticker, sector, CIK). A copy is kept in `data/sp500.json`. |

The parser only keeps a pay figure when CEO pay ÷ median pay matches the ratio the company states (allowing for rounding). That cross-check is what keeps it from picking up the wrong number in a 200-page proxy.

Years are fiscal years, named for the calendar year they end in.

## Run it on your computer

1. Install Node.js 18 or newer from https://nodejs.org (the "LTS" version).
2. Open a terminal in this folder and run:
   ```
   npm start
   ```
3. Open http://localhost:3000.

There is nothing else to install. The app has no outside packages.

## Updating the data

The data refreshes itself every Monday through GitHub Actions (`.github/workflows/update-data.yml`), which commits any new numbers; Render then redeploys.

**One-time setup:** in the GitHub repository, go to Settings > Secrets and variables > Actions > New repository secret. Name it `SEC_USER_AGENT` and set it to a name and contact email, for example `Corner Office Math you@example.com`. The SEC blocks automated requests that don't identify themselves this way.

The first full run reads about 4,500 proxy statements and takes a few hours. Each run stops cleanly after about 5 hours 20 minutes and the next run continues where it left off, so start it by hand from the Actions tab (Update data > Run workflow) once or twice to fill everything in. Later runs only read new filings.

To run it on your computer instead:

```
cp .env.example .env        # then put your email in SEC_USER_AGENT
npm run update-data                         # everything
npm run update-data -- --only AAPL,MSFT    # a few companies
npm run update-data -- --rebuild           # rebuild output from the cache, no downloads
```

## Putting it online (Render)

Same setup as What 2 Watch:

1. Push this repository to GitHub.
2. In Render, choose New > Blueprint and pick the repository. `render.yaml` sets up a free web service (`node server.js`).
   Or choose New > Web Service, pick the repository, and set Build Command to `true` and Start Command to `node server.js`.
3. No keys are needed to run the site. `SEC_USER_AGENT` is only used by the data update, which runs in GitHub Actions.

## How it's built

```
server.js                 Small Node server: serves public/ and the data files
public/                   The web page: index.html, styles.css, app.js, charts.js
scripts/update-data.js    Data builder: reads EDGAR and writes data/
scripts/lib/              EDGAR client, HTML-to-text, pay ratio parser, revenue picker
data/index.json           Summary of every company plus S&P 500 trends (built)
data/companies/*.json     One file per company, one row per year (built)
data/cache/*.json         What has already been read from each filing (so updates are quick)
test/                     Parser tests (npm test)
```

## Going back before 2018 (planned)

Companies only had to disclose median employee pay from 2018. To extend back to 1993, the plan is:

- Revenue and CEO pay: from filings where available (no scanning of old paper documents).
- Median employee pay: an estimate from Bureau of Labor Statistics wages for the company's industry.

Every yearly row already carries a `source` field (`"sec"` today). Estimated years will use `"bls-estimate"`, and the site already draws those differently: dashed lines, hollow points, and "(est.)" in tables. The cut-off year lives in `scripts/lib/build.js` (`FIRST_YEAR`).
