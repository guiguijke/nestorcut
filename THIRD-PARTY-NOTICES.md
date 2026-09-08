# Third-party notices

NestorCut's own contributions are licensed under the PolyForm Noncommercial
License 1.0.0 (see `LICENSE`). This repository also contains code that
keeps its own license terms, listed below. Where a component is vendored
(copied into this repository), its license file sits next to it.

| Component | License | Location | Notes |
|---|---|---|---|
| nest2d (Volodymyr Stelmashchuk) | MIT | scaffolding inherited from the fork base (commit `cc1a459` of the original project, 2026-06-13) | full notice in `LICENSE-MIT-nest2d`; modifications since the fork are NestorCut contributions |
| sparrow (Jeroen Gardeyn, KU Leuven) | MIT | `workers/nesting/engine/crates/sparrow/` (vendored, adapted as a library) | `crates/sparrow/LICENSE`, `workers/nesting/engine/NOTICE` |
| jagua-rs 0.7.2 (Jeroen Gardeyn) | MPL-2.0 | `workers/nesting/engine/crates/jagua-rs/` (vendored, **modified**) | `crates/jagua-rs/LICENSE`; modified files are listed in `crates/jagua-rs/VENDORED.patch.md` (`src/probs/spp/io/import.rs`, `src/probs/bpp/io/import.rs`, `src/probs/mspp/io/import.rs`, `src/geometry/transformation.rs`) and remain under MPL-2.0; their source is in this repository, as MPL-2.0 §3.2 requires for the WebAssembly binary shipped to browsers |
| dxf-viewer | MPL-2.0 | npm dependency (unmodified) | — |
| GNU LibreDWG (`dwgread`) | GPL-3.0 | invoked as a separate process by the file-processing worker, never linked | `docs/dwg-license.md` |
| spyrrow | MIT | legacy strip-nesting worker (not deployed) | — |
| Other npm, PyPI and crates.io dependencies | as declared by each package | `package.json`, `requirements*.txt`, `Cargo.toml` | listed on the application's `/licences` page (`data/licences.js`) |

Trademarks: see `TRADEMARK.md`.
