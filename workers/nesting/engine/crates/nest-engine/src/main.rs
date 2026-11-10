use anyhow::{Context, Result};
use clap::Parser;
use nest_engine::run_json;
use std::path::PathBuf;

/// Nest2D nesting engine.
///
/// File-based CLI (lbf conventions): reads an instance + engine config,
/// optimizes, and writes sol_instance.json + alternatives.json to the output
/// directory. stdout carries ONLY JSON progress lines (one per line) for the
/// Python worker to relay; diagnostics go to stderr.
#[derive(Parser)]
#[command(name = "nest-engine", version, about)]
struct Cli {
    /// Path to the instance JSON file (jagua-rs external representation)
    #[arg(short = 'i', long, required_unless_present = "merge")]
    input: Option<PathBuf>,

    /// Path to the engine config JSON file
    #[arg(short = 'c', long, required_unless_present = "merge")]
    config: Option<PathBuf>,

    /// Output directory for sol_instance.json / alternatives.json
    #[arg(short = 's', long)]
    output: PathBuf,

    /// Problem type: spp (strip packing, single sheet type) or bpp (bin packing, multi-sheet)
    #[arg(short = 'p', long, value_parser = ["spp", "bpp"], required_unless_present = "merge")]
    problem: Option<String>,

    /// Mode fusion (verrou de déterminisme natif ≡ wasm) : lit l'entrée JSON
    /// de `merge_alternatives` (pool de walks navigateur) et écrit
    /// `merged.json` dans le dossier de sortie. Même fonction que l'export
    /// wasm `merge_alternatives`. N'est pas utilisé par le worker Python.
    #[arg(long, conflicts_with_all = ["input", "config", "problem"])]
    merge: Option<PathBuf>,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    std::fs::create_dir_all(&cli.output)
        .with_context(|| format!("creating output dir {}", cli.output.display()))?;

    if let Some(merge_path) = &cli.merge {
        let raw = std::fs::read_to_string(merge_path)
            .with_context(|| format!("reading merge input {}", merge_path.display()))?;
        let input: serde_json::Value = serde_json::from_str(&raw).context("parsing merge input")?;
        match nest_engine::merge::merge_alternatives_json(&input) {
            Ok(merged) => {
                std::fs::write(cli.output.join("merged.json"), serde_json::to_string(&merged)?)?;
                return Ok(());
            }
            Err(e) => {
                eprintln!("nest-engine failed: {e:#}");
                std::process::exit(1);
            }
        }
    }

    // clap garantit la présence de ces trois arguments hors mode fusion.
    let (Some(input), Some(config), Some(problem)) = (&cli.input, &cli.config, &cli.problem) else {
        anyhow::bail!("--input, --config and --problem are required");
    };
    let instance_str = std::fs::read_to_string(input)
        .with_context(|| format!("reading instance {}", input.display()))?;
    let config_str = std::fs::read_to_string(config)
        .with_context(|| format!("reading config {}", config.display()))?;

    let result = run_json(problem, &instance_str, &config_str).and_then(|out| {
        std::fs::write(
            cli.output.join("sol_instance.json"),
            serde_json::to_string_pretty(&out.sol_instance)?,
        )?;
        std::fs::write(
            cli.output.join("alternatives.json"),
            serde_json::to_string_pretty(&out.alternatives)?,
        )?;
        Ok(())
    });

    if let Err(e) = &result {
        // Machine-readable failure for the worker (in addition to the
        // non-zero exit code); details on stderr for humans.
        eprintln!("nest-engine failed: {e:#}");
        std::process::exit(1);
    }
    Ok(())
}
