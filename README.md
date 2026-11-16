# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/qianli98666-ai/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/qianli98666-ai/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar that ranks every pre-token protocol in the DefiLlama snapshot by implied value — not by TVL. Each protocol is priced against the live tokens in its own category: implied value = TVL × the category's median live market-cap/TVL × a growth multiplier × a maturity multiplier, so a $2B protocol with no token is worth what the market actually pays for a dollar of its kind of TVL. Only farmable protocols are ranked — the house's own watchlist rule is applied to the whole board, so bridges, wrapped and staked products, exchanges and versioned pools are left out (a bridge's TVL is value passing through, not value the protocol owns). The board covers all 40 watchlist protocols plus 158 early pre-token rows, every one with a concrete farm plan (what to do, what it costs, how long it takes) derived from the same snapshot figures. The dashboard is a static page with a sortable, filterable board, a top-pick hero, a top-ten chart, per-protocol detail views, and a model sandbox that re-ranks the board live.

## Run it

```sh
node main.ts
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot at `/input/snapshot.json` and writes the ranked board to `/output/board.json`, the dashboard data to `/output/data.js`, the dashboard to `/output/dashboard/`, the screenshots to `/output/screenshots/`, and the judge's summary to `/output/dossier.json`. For a local run, point it at a snapshot and an output directory instead: `MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ksr8yfyv&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
