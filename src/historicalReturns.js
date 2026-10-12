/**
 * What the market actually paid, one calendar year at a time — the sequence
 * `runHistoricalBacktest` (`retirementSimulation.js`) replays a retirement
 * plan through instead of drawing from an assumed distribution.
 *
 * **Source and method, stated once so nothing here looks more precise than it
 * is.** Nominal annual total returns for the S&P 500 (with dividends
 * reinvested) and the 10-year US Treasury (with coupon) are NYU Stern's
 * Aswath Damodaran "Returns on Stocks, Bonds and Bills: 1928–2025" table
 * (https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html,
 * fetched 2026, page dated "Updated: January 5, 2026") — the same long-run
 * series most FIRE-calculator tools (cFIREsim, FIRECalc and others) trace
 * back to. Inflation is US CPI, year-over-year, from multpl.com's historical
 * series (https://www.multpl.com/inflation/table/by-year), which reports a
 * trailing-twelve-month reading each January; the reading labelled "Jan 1,
 * Y+1" is what lines up with calendar year Y's Dec/Dec inflation — checked
 * against ten widely-published anchor years (1946, 1949, 1974, 1979, 1982,
 * 2008, 2009, 2020, 2021, 2022) before being trusted for every other year.
 *
 * Each entry below is `(1 + nominal) / (1 + that year's CPI) − 1`, rounded to
 * the basis point, computed once here rather than at runtime — this file
 * carries no re-deflation step, the way `socialSecurity.js`'s statutory
 * constants carry no recomputation either. **Ninety-eight years, 1928
 * through 2025** — the full range both series cover in common.
 */
export const HISTORICAL_RETURNS = [
  { year: 1928, equityRealReturnBps: 4550, bondRealReturnBps: 202 },
  { year: 1929, equityRealReturnBps: -830, bondRealReturnBps: 420 },
  { year: 1930, equityRealReturnBps: -1947, bondRealReturnBps: 1243 },
  { year: 1931, equityRealReturnBps: -3756, bondRealReturnBps: 834 },
  { year: 1932, equityRealReturnBps: 127, bondRealReturnBps: 2060 },
  { year: 1933, equityRealReturnBps: 4657, bondRealReturnBps: -46 },
  { year: 1934, equityRealReturnBps: -410, bondRealReturnBps: 479 },
  { year: 1935, equityRealReturnBps: 4461, bondRealReturnBps: 296 },
  { year: 1936, equityRealReturnBps: 2914, bondRealReturnBps: 279 },
  { year: 1937, equityRealReturnBps: -3580, bondRealReturnBps: 67 },
  { year: 1938, equityRealReturnBps: 3113, bondRealReturnBps: 570 },
  { year: 1939, equityRealReturnBps: -39, bondRealReturnBps: 516 },
  { year: 1940, equityRealReturnBps: -1194, bondRealReturnBps: 390 },
  { year: 1941, equityRealReturnBps: -2166, bondRealReturnBps: -1201 },
  { year: 1942, equityRealReturnBps: 1071, bondRealReturnBps: -497 },
  { year: 1943, equityRealReturnBps: 2146, bondRealReturnBps: -46 },
  { year: 1944, equityRealReturnBps: 1635, bondRealReturnBps: 27 },
  { year: 1945, equityRealReturnBps: 3283, bondRealReturnBps: 152 },
  { year: 1946, equityRealReturnBps: -2248, bondRealReturnBps: -1270 },
  { year: 1947, equityRealReturnBps: -456, bondRealReturnBps: -845 },
  { year: 1948, equityRealReturnBps: 437, bondRealReturnBps: 67 },
  { year: 1949, equityRealReturnBps: 2081, bondRealReturnBps: 688 },
  { year: 1950, equityRealReturnBps: 2102, bondRealReturnBps: -709 },
  { year: 1951, equityRealReturnBps: 1855, bondRealReturnBps: -444 },
  { year: 1952, equityRealReturnBps: 1770, bondRealReturnBps: 188 },
  { year: 1953, equityRealReturnBps: -231, bondRealReturnBps: 298 },
  { year: 1954, equityRealReturnBps: 5370, bondRealReturnBps: 406 },
  { year: 1955, equityRealReturnBps: 3211, bondRealReturnBps: -170 },
  { year: 1956, equityRealReturnBps: 432, bondRealReturnBps: -510 },
  { year: 1957, equityRealReturnBps: -1359, bondRealReturnBps: 307 },
  { year: 1958, equityRealReturnBps: 4174, bondRealReturnBps: -345 },
  { year: 1959, equityRealReturnBps: 1092, bondRealReturnBps: -364 },
  { year: 1960, equityRealReturnBps: -135, bondRealReturnBps: 976 },
  { year: 1961, equityRealReturnBps: 2580, bondRealReturnBps: 138 },
  { year: 1962, equityRealReturnBps: -1001, bondRealReturnBps: 430 },
  { year: 1963, equityRealReturnBps: 2063, bondRealReturnBps: 4 },
  { year: 1964, equityRealReturnBps: 1530, bondRealReturnBps: 273 },
  { year: 1965, equityRealReturnBps: 1028, bondRealReturnBps: -118 },
  { year: 1966, equityRealReturnBps: -1298, bondRealReturnBps: -53 },
  { year: 1967, equityRealReturnBps: 1944, bondRealReturnBps: -505 },
  { year: 1968, equityRealReturnBps: 614, bondRealReturnBps: -108 },
  { year: 1969, equityRealReturnBps: -1358, bondRealReturnBps: -1054 },
  { year: 1970, equityRealReturnBps: -164, bondRealReturnBps: 1088 },
  { year: 1971, equityRealReturnBps: 1060, bondRealReturnBps: 631 },
  { year: 1972, equityRealReturnBps: 1458, bondRealReturnBps: -80 },
  { year: 1973, equityRealReturnBps: -2167, bondRealReturnBps: -524 },
  { year: 1974, equityRealReturnBps: -3372, bondRealReturnBps: -877 },
  { year: 1975, equityRealReturnBps: 2837, bondRealReturnBps: -291 },
  { year: 1976, equityRealReturnBps: 1769, bondRealReturnBps: 1023 },
  { year: 1977, equityRealReturnBps: -1294, bondRealReturnBps: -519 },
  { year: 1978, equityRealReturnBps: -253, bondRealReturnBps: -921 },
  { year: 1979, equityRealReturnBps: 405, bondRealReturnBps: -1162 },
  { year: 1980, equityRealReturnBps: 1780, bondRealReturnBps: -1325 },
  { year: 1981, equityRealReturnBps: -1208, bondRealReturnBps: -18 },
  { year: 1982, equityRealReturnBps: 1611, bondRealReturnBps: 2806 },
  { year: 1983, equityRealReturnBps: 1742, bondRealReturnBps: -95 },
  { year: 1984, equityRealReturnBps: 253, bondRealReturnBps: 985 },
  { year: 1985, equityRealReturnBps: 2633, bondRealReturnBps: 2100 },
  { year: 1986, equityRealReturnBps: 1678, bondRealReturnBps: 2249 },
  { year: 1987, equityRealReturnBps: 169, bondRealReturnBps: -866 },
  { year: 1988, equityRealReturnBps: 1134, bondRealReturnBps: 339 },
  { year: 1989, equityRealReturnBps: 2498, bondRealReturnBps: 1187 },
  { year: 1990, equityRealReturnBps: -824, bondRealReturnBps: 56 },
  { year: 1991, equityRealReturnBps: 2693, bondRealReturnBps: 1209 },
  { year: 1992, equityRealReturnBps: 410, bondRealReturnBps: 591 },
  { year: 1993, equityRealReturnBps: 727, bondRealReturnBps: 1140 },
  { year: 1994, equityRealReturnBps: -143, bondRealReturnBps: -1054 },
  { year: 1995, equityRealReturnBps: 3355, bondRealReturnBps: 2020 },
  { year: 1996, equityRealReturnBps: 1906, bondRealReturnBps: -156 },
  { year: 1997, equityRealReturnBps: 3104, bondRealReturnBps: 824 },
  { year: 1998, equityRealReturnBps: 2623, bondRealReturnBps: 1303 },
  { year: 1999, equityRealReturnBps: 1767, bondRealReturnBps: -1070 },
  { year: 2000, equityRealReturnBps: -1230, bondRealReturnBps: 1247 },
  { year: 2001, equityRealReturnBps: -1284, bondRealReturnBps: 438 },
  { year: 2002, equityRealReturnBps: -2395, bondRealReturnBps: 1220 },
  { year: 2003, equityRealReturnBps: 2593, bondRealReturnBps: -152 },
  { year: 2004, equityRealReturnBps: 755, bondRealReturnBps: 148 },
  { year: 2005, equityRealReturnBps: 81, bondRealReturnBps: -108 },
  { year: 2006, equityRealReturnBps: 1325, bondRealReturnBps: -12 },
  { year: 2007, equityRealReturnBps: 115, bondRealReturnBps: 569 },
  { year: 2008, equityRealReturnBps: -3657, bondRealReturnBps: 2006 },
  { year: 2009, equityRealReturnBps: 2271, bondRealReturnBps: -1340 },
  { year: 2010, equityRealReturnBps: 1298, bondRealReturnBps: 672 },
  { year: 2011, equityRealReturnBps: -81, bondRealReturnBps: 1274 },
  { year: 2012, equityRealReturnBps: 1408, bondRealReturnBps: 136 },
  { year: 2013, equityRealReturnBps: 3009, bondRealReturnBps: -1051 },
  { year: 2014, equityRealReturnBps: 1362, bondRealReturnBps: 1085 },
  { year: 2015, equityRealReturnBps: 1, bondRealReturnBps: -9 },
  { year: 2016, equityRealReturnBps: 904, bondRealReturnBps: -177 },
  { year: 2017, equityRealReturnBps: 1914, bondRealReturnBps: 72 },
  { year: 2018, equityRealReturnBps: -569, bondRealReturnBps: -155 },
  { year: 2019, equityRealReturnBps: 2802, bondRealReturnBps: 698 },
  { year: 2020, equityRealReturnBps: 1639, bondRealReturnBps: 979 },
  { year: 2021, equityRealReturnBps: 1953, bondRealReturnBps: -1107 },
  { year: 2022, equityRealReturnBps: -2298, bondRealReturnBps: -2278 },
  { year: 2023, equityRealReturnBps: 2228, bondRealReturnBps: 77 },
  { year: 2024, equityRealReturnBps: 2124, bondRealReturnBps: -450 },
  { year: 2025, equityRealReturnBps: 1503, bondRealReturnBps: 528 },
];

export const HISTORICAL_START_YEAR = HISTORICAL_RETURNS[0].year;
export const HISTORICAL_END_YEAR = HISTORICAL_RETURNS[HISTORICAL_RETURNS.length - 1].year;

/**
 * The real return the market actually delivered in `calendarYear`, wrapping
 * around to `dataset`'s first year once a cohort's horizon runs past its
 * last — the cFIREsim convention for a plan that outlives the data, rather
 * than a cohort simply stopping mid-plan. `dataset` defaults to the real
 * series above; `retirementSimulation.test.js` passes a synthetic one.
 */
export function historicalReturnAt(calendarYear, dataset = HISTORICAL_RETURNS) {
  const span = dataset.length;
  const offset = (((calendarYear - dataset[0].year) % span) + span) % span;
  return dataset[offset];
}
