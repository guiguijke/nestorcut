//! nest-report-cli — driver du harnais de parité rapport.
//! Entrée JSON : {items, containers, space} → sortie {per_sheet, totals,
//! used_share, verify}.
use nest_report::{
    compute_used_sheet_share, per_sheet_metrics, report_totals, verify_layout_edge, Container, Item,
};
use std::io::Read;

#[derive(serde::Deserialize)]
struct Spec {
    items: Vec<Item>,
    containers: Vec<Container>,
    #[serde(default)]
    space: f64,
    /// Distance au bord propre (mm, convention interne de `space`). Absente :
    /// rapport d'avant, octet pour octet.
    #[serde(default)]
    edge: Option<f64>,
}

fn main() {
    let mut buf = String::new();
    std::io::stdin().read_to_string(&mut buf).unwrap();
    let spec: Spec = serde_json::from_str(&buf).unwrap();
    let sheets = per_sheet_metrics(&spec.containers, &spec.items);
    let totals = report_totals(&sheets);
    let used = compute_used_sheet_share(&spec.containers, &spec.items);
    let verify = verify_layout_edge(&spec.containers, &spec.items, spec.space, spec.edge);
    println!(
        "{}",
        serde_json::json!({
            "per_sheet": sheets,
            "totals": totals,
            "used_sheet_share": used,
            "verify": verify,
        })
    );
}
