# Native analyzer oracle

`input.json` and `expected.json` are generated with the unchanged v1 analyzer by
`scripts/generate-analyzer-fixtures.py`. The script records all seven numeric
result groups through v1's own JSON serializer. Python is needed only to regenerate
the oracle, not to run the native app or Rust tests.

Comparison tolerance: `abs(actual - expected) <= 1e-9 * max(1, abs(expected))`.
Daily aggregates retain v1's three decimals; state means retain two decimals.
Standard deviations use one degree of freedom and quantiles use linear
interpolation. Null represents an undefined statistic, including constant-column
correlations and single-sample standard deviations.

Unprefixed times start on Monday and detect midnight by a decreasing clock, as
in v1. The native parser also accepts the Spanish weekday prefixes emitted by
current v1/v2 exporters. These prefixes identify the first weekday and subsequent
weekday changes; they never depend on the UI language.
