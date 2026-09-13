/**
 * Domain registry for the nesting flavours. Only "bin" (classic workspace
 * projects) remains: le pipeline « strip » a été retiré le 2026-09-13
 * (docs/PLAN-RETRAIT-STRIP-2026-09-13.md) — ses collections et buckets
 * restent en base, intacts, mais plus aucune route ne les sert.
 *
 * Collections and GridFS buckets stay separate per domain — this registry is
 * the single place mapping a domain to its storage and naming, so the shared
 * services in server/core/project/ never hardcode them. Adding another
 * nesting flavour should only require a new entry here.
 */
export const DOMAINS = {
  bin: {
    id: "bin",
    projectsCollection: "projects",
    filesCollection: "user_dxf_files",
    jobsCollection: "nesting_jobs",
    // Field on file/job docs referencing the owning project slug.
    projectSlugField: "projectSlug",
    dxfBucket: "userDxf",
    workerTag: "normal",
    jobSlugPrefix: "nested-",
    projectLabel: "Project",
    trackCreateFile: "create_project_dxf_file",
    // The bin project list also exposes the raw jobs queue and per-project
    // result counts to the UI.
    includeJobsInProjectList: true,
    // Reject foreign slugs with 404 (same as missing) so a guessed slug
    // cannot leak the project name / createdAt (pentest M-4).
    rejectForeignProject: true,
  },
};
