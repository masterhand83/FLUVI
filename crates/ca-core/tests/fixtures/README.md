# Traffic reference fixtures

Run `node scripts/generate-traffic-rules.mjs` from the repository root.
Commit both fixtures and the generated Rust table after a v1 rule change.
Node is needed to regenerate these files, not to run the Rust tests.

- `traffic-rules.csv` contains the evaluated v1 object, not its source text.
  Duplicate keys have JavaScript's last-key-wins semantics. Missing keys stay absent.
- `traffic-trajectory.csv` contains 20 ticks for each of seeds 42 and 43.
  The generator evaluates the actual v1 direction, generation and ordinary-street
  update functions. It uses SplitMix64 in place of `Math.random`, empty boundary
  cells, no connections or parking, and no hourly multiplier.
  Each street has two eight-cell lanes, directions +1/-1, probability 0.45,
  and all lanes enabled. Cells are lane-major physical indices.

Rust tests compare raw rule results, hand-computed street updates, and the v1
trajectories. The trajectory oracle is separate from the Rust update implementation.
