//! nest-import-cli: reads a DXF or SVG file and prints the ImportResult JSON
//! on stdout — the parity-harness driver (workers/geometry/parity/).
//! Format detected by CONTENT signature (AGENTS #31), never by extension.

use std::io::{Read, Write};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: nest-import-cli <file.dxf|file.svg> [flatten_tol | --canonical | --sheet [flatten_tol]]");
        std::process::exit(2);
    }
    let canonical = args.get(2).is_some_and(|a| a == "--canonical");
    let sheet = args.get(2).is_some_and(|a| a == "--sheet");
    let tol: f64 = if sheet {
        args.get(3).and_then(|s| s.parse().ok()).unwrap_or(0.01)
    } else {
        args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0.01)
    };
    let mut buf = Vec::new();
    match std::fs::File::open(&args[1]).and_then(|mut f| f.read_to_end(&mut buf)) {
        Ok(_) => {}
        Err(e) => {
            eprintln!("cannot read {}: {e}", args[1]);
            std::process::exit(1);
        }
    }
    if sheet {
        // La tôle : les contours du dessin (nest_import::sheet), JSON sur stdout.
        match nest_import::sheet::import_sheet_contours(&buf, tol, &nest_import::budget::Limits::unlimited()) {
            Ok(res) => println!("{}", serde_json::to_string(&res).unwrap()),
            Err(e) => {
                eprintln!("sheet import failed: {e}");
                std::process::exit(1);
            }
        }
        return;
    }
    if canonical {
        // Les octets DXF canoniques, ceux que le navigateur stocke et dont
        // l'export copie les entités (parity/wcs_check.py les relit par ezdxf).
        match nest_import::canonical_dxf(&buf, tol) {
            Ok(bytes) => std::io::stdout().write_all(&bytes).expect("stdout"),
            Err(e) => {
                eprintln!("canonical failed: {e}");
                std::process::exit(1);
            }
        }
        return;
    }
    match nest_import::import_file(&buf, tol) {
        Ok(res) => {
            println!("{}", serde_json::to_string(&res).unwrap());
        }
        Err(e) => {
            eprintln!("import failed: {e}");
            std::process::exit(1);
        }
    }
}
