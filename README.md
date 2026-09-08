<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./public/brand/nestorcut-logo-dark-master.png">
    <source media="(prefers-color-scheme: light)" srcset="./public/brand/nestorcut-logo-light-master.png">
    <img src="./public/brand/nestorcut-logo-light-master.png" alt="NestorCut" width="420">
  </picture>
</p>

# NestorCut

Nesting for plotters, laser & plasma cutters, and other CNC machines.

NestorCut is a SaaS nesting platform: upload your DXF/SVG/DWG parts, get
optimized cutting layouts with a full material report — ready to cut in
seconds. The product lives at [nestorcut.com](https://nestorcut.com) (app:
[app.nestorcut.com](https://app.nestorcut.com)).

This repository is the source of that platform. It is published so that
the promise « your files never leave your machine » (browser nesting)
can be read and verified, and so that the public benchmarks are
reproducible. It is **not** a self-hosting kit and **not** open source:
NestorCut's contributions are licensed for noncommercial use only (see
License below) — if you want to nest parts, use the hosted service.

## Features

- **True-shape nesting engine (Rust)** — separation/compaction with
  simulated annealing and multi-start parallelism (jagua-rs + sparrow)
- **DXF, SVG & DWG import** — content-signature detection, all conversions
  run in our own containers
- **Hole nesting** — small parts nested inside larger parts' cutouts
- **Canonical grid alternative** — for rectangular-part jobs: exact
  lattice + successive filled zones + analytic small-part tiling,
  deterministic, shown next to the engine layouts
- **Multi-sheet jobs & layout alternatives** — densest, largest remnant,
  balanced
- **Material report** — measured areas per sheet, reusable-offcut
  detection, CSV export
- **Zero-knowledge vault** — client-side AES-256-GCM encryption with a key
  file only you hold
- **Shared demo project** — try the engine without uploading anything
- **mm/inch units**, EN/FR interface

## Tech stack

Nuxt 4 (frontend + API) · MongoDB (GridFS) · Python workers · Rust nesting
engine (native + WebAssembly, in-browser mode included). Architecture:
`docs/ARCHITECTURE.md` — internal notes for contributors live in `AGENTS.md`.

## Credits

NestorCut started as a fork of [nest2d](https://github.com/VovaStelmashchuk/nest2d) by **Volodymyr Stelmashchuk** — thank you for open-sourcing it. The codebase has since been heavily extended and rewritten: Rust nesting engine (sparrow/jagua-rs), zero-knowledge vault, SVG/DWG import pipeline, material report, monetization, shared demo project.

Engine: [jagua-rs](https://github.com/JeroenGar/jagua-rs) and [sparrow](https://github.com/JeroenGar/sparrow) by **[JeroenGar](https://github.com/JeroenGar)** (see `workers/nesting/engine/NOTICE`).

Other inspirations:
- [SVGNest](https://github.com/Jack000/SVGnest)
- [Deepnest](https://github.com/deepnest-next)
- [NEST4J fork](https://github.com/micycle1/Nest4J/tree/master)

### Referenced papers

- [López-Camacho _et al._ 2013](http://www.cs.stir.ac.uk/~goc/papers/EffectiveHueristic2DAOR2013.pdf)
- [Kendall 2000](http://www.graham-kendall.com/papers/k2001.pdf)
- [E.K. Burke _et al._ 2006](http://citeseerx.ist.psu.edu/viewdoc/download?doi=10.1.1.440.379&rep=rep1&type=pdf)

## License

- **NestorCut contributions** (engine, geometry, post-pass, browser path,
  vault, admin, docs, brand): **PolyForm Noncommercial License 1.0.0** —
  free for personal, research, educational and non-profit use; **no
  commercial use** and no derived hosted service. Commercial licensing:
  contact via [nestorcut.com](https://nestorcut.com). See [LICENSE](./LICENSE).
- **Parts inherited from [nest2d](https://github.com/VovaStelmashchuk/nest2d)**
  (Volodymyr Stelmashchuk): MIT — see [LICENSE-MIT-nest2d](./LICENSE-MIT-nest2d).
- **Third-party code** (sparrow MIT, jagua-rs MPL-2.0 with modified files,
  dxf-viewer MPL-2.0, LibreDWG GPL-3.0 as a separate process): see
  [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
- Names and logos are not licensed: see [TRADEMARK.md](./TRADEMARK.md).

History: this repository was re-created on 2026-09 with a single initial
commit; commit hashes quoted in older documents refer to the archived
private repository.
