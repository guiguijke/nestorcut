import standardSlugify from "standard-slugify";

import { connectDB } from "~~/server/db/mongo";
import { saveFiles } from "~~/server/core/project/dxf";
import {
  generateRandomString,
  generateEntityName,
  titleFromFileName,
  PROJECT_SLUG_RANDOM_LEN,
} from "~~/server/utils/strings";
import { assertCanNest, refundNestCharge } from "~~/server/utils/entitlement";
import { requireFileAccess, resolvePolygonParts } from "~~/server/utils/vault";
import { resolvePartColor } from "~~/server/utils/colors";
import {
  DEMO_OWNER_ID,
  DEMO_PROJECT_SLUG,
} from "../../../shared/constants/demo.constants";

/**
 * Shared services for the bin domain (workspace projects). Every function
 * takes the domain config (server/core/domains.js) as first argument; the
 * routes in server/api/project/** are thin shells around them (auth and
 * param validation stay in the routes).
 */

/**
 * Creates a project with a generated name/slug and saves the uploaded DXF
 * files (POST /api/project).
 */
export async function createProjectWithFiles(domain, event, userId) {
  const db = await connectDB();
  const projectName = generateEntityName();
  const projectSlug = `${standardSlugify(projectName, {
    keepCase: false,
  })}-${generateRandomString(PROJECT_SLUG_RANDOM_LEN)}`;

  await db.collection(domain.projectsCollection).insertOne({
    slug: projectSlug,
    name: projectName,
    createdAt: new Date(),
    ownerId: userId,
  });

  const records = await saveFiles(domain, event, projectSlug, userId);
  const fromFile = titleFromFileName(records?.[0]?.name);
  if (fromFile && fromFile !== projectName) {
    await db.collection(domain.projectsCollection).updateOne(
      { slug: projectSlug },
      { $set: { name: fromFile } },
    );
  }

  return {
    slug: projectSlug,
  };
}

/**
 * J-090 — projet « 100 % privé » : le doc serveur ne porte QUE des
 * métadonnées (nom, dates, quota). Les fichiers sont parsés dans le
 * navigateur et vivent dans IndexedDB ; la géométrie ne transite jamais.
 * Aucun fichier à la création (l'import arrive ensuite, côté client).
 */
export async function createLocalProject(domain, userId) {
  const db = await connectDB();
  const projectName = generateEntityName();
  const projectSlug = `${standardSlugify(projectName, {
    keepCase: false,
  })}-${generateRandomString(PROJECT_SLUG_RANDOM_LEN)}`;

  await db.collection(domain.projectsCollection).insertOne({
    slug: projectSlug,
    name: projectName,
    createdAt: new Date(),
    ownerId: userId,
    local: true,
  });

  return {
    slug: projectSlug,
  };
}

/**
 * Lists the user's projects, newest first. Bin projects also expose the raw
 * jobs queue and per-project result counts (domain.includeJobsInProjectList).
 * The shared read-only demo project is pinned first for everyone (bin
 * domain only) — it never appears in the user's own list since its ownerId
 * is the technical demo account.
 */
export async function listProjects(domain, userId) {
  const db = await connectDB();
  const projects = await db
    .collection(domain.projectsCollection)
    .find({ ownerId: userId })
    .sort({ createdAt: -1 })
    .project({ slug: 1, name: 1, createdAt: 1, local: 1 })
    .toArray();

  const demoProject = domain.includeJobsInProjectList
    ? await db
        .collection(domain.projectsCollection)
        .findOne(
          { slug: DEMO_PROJECT_SLUG, isDemo: true },
          { projection: { slug: 1, name: 1, createdAt: 1 } }
        )
    : null;

  if (!domain.includeJobsInProjectList) {
    return {
      projects: projects.map((project) => ({
        slug: project.slug,
        name: project.name,
        createdAt: project.createdAt,
        results: 0,
      })),
    };
  }

  const queueList = await db
    .collection(domain.jobsCollection)
    .find({ ownerId: userId })
    .sort({ createdAt: -1 })
    .project({ [domain.projectSlugField]: 1 })
    .toArray();

  const toUi = (project, extra = {}) => ({
    slug: project.slug,
    name: project.name,
    createdAt: project.createdAt,
    // J-090 : projet 100 % privé (fichiers jamais uploadés) — badge UI.
    ...(project.local ? { local: true } : {}),
    results: queueList.filter(
      (queueItem) => queueItem[domain.projectSlugField] === project.slug
    ).length,
    ...extra,
  });

  return {
    queueList: queueList,
    projects: [
      ...(demoProject ? [toUi(demoProject, { isDemo: true })] : []),
      ...projects.map((project) => toUi(project)),
    ],
  };
}

/**
 * Fetches a project and rejects access when it does not belong to the user
 * (used by the addfiles routes before touching files).
 */
export async function assertProjectAccess(domain, userId, slug) {
  const db = await connectDB();
  const project = await db
    .collection(domain.projectsCollection)
    .findOne({ slug: slug });

  if (!project) {
    throw createError({
      statusCode: 404,
      message: `${domain.projectLabel} not found`,
    });
  }

  if (project.ownerId !== userId) {
    throw createError({ statusCode: 403, message: "Forbidden" });
  }

  return project;
}

/**
 * Project detail with its files mapped for the UI (GET /api/project/[slug]
 * (/api/project/[slug]). The shared demo project is readable by everyone:
 * the 403 check is skipped and its files are listed by the technical demo
 * owner instead of the caller.
 */
export async function getProjectFiles(domain, userId, slug) {
  const db = await connectDB();
  const project = await db.collection(domain.projectsCollection).findOne(
    { slug: slug },
    {
      projection: {
        name: 1,
        slug: 1,
        ownerId: 1,
        isDemo: 1,
        local: 1,
      },
    }
  );

  if (!project) {
    throw createError({
      statusCode: 404,
      message: `${domain.projectLabel} not found`,
    });
  }

  const isDemo = Boolean(project.isDemo);
  if (!isDemo && domain.rejectForeignProject && project.ownerId !== userId) {
    throw createError({
      statusCode: 404,
      message: `${domain.projectLabel} not found`,
    });
  }

  const projectFiles = project.local
    ? [] // J-090 : les fichiers d'un projet local vivent dans IndexedDB —
         // le serveur n'a aucune géométrie à servir.
    : await db
        .collection(domain.filesCollection)
        .find({
          [domain.projectSlugField]: slug,
          ownerId: isDemo ? DEMO_OWNER_ID : userId,
          // Lot E2 : un dessin ECLATE n'est pas une fiche — ses pièces en
          // sont. Le document d'origine reste en base (provenance, purge
          // 24 h) mais quitte la liste, comme côté navigateur où le dessin
          // complet n'a jamais de carte. Champ additif : les fichiers
          // d'avant ne le portent pas et restent visibles.
          explodedInto: { $exists: false },
        })
        .sort({ uploadAt: 1 })
        .toArray();

  const files = await Promise.all(
    projectFiles.map((file) => FILE_MAPPERS[domain.id](userId, file))
  );

  return {
    name: project.name,
    slug: project.slug,
    isDemo,
    // J-090 : projet 100 % privé — la page hydrate ses fichiers depuis
    // IndexedDB, jamais depuis le serveur.
    local: Boolean(project.local),
    files,
  };
}

const mapProcessingStatus = (processingStatus) => {
  if (processingStatus === "completed") {
    return "done";
  } else if (processingStatus === "processing" || processingStatus === "pending") {
    return "in-progress";
  }
  return processingStatus;
};

const mapBinFileToUi = async (userId, file) => {
  const completed = file.processingStatus === "completed";
  // Lot 2c : un fichier garé par la garde d'import (lot 2a) reste
  // « pending » en base — le worker ne le reprendra pas. Le montrer « en
  // cours » indéfiniment est un mensonge : c'est un échec, avec une cause.
  const refused = Boolean(file.importRefusal) && !completed;

  // Decrypts the enc blob when the vault is enabled (403 vault_locked if no
  // active session), passes legacy plaintext through untouched.
  const parts = await resolvePolygonParts(userId, file);

  return {
    slug: file.slug,
    name: file.name,
    svgUrl: completed ? `/api/files/project/svg/${file.svgFileSlug}` : null,
    dxfUrl: completed ? `/api/files/project/dxf/${file.slug}` : null,
    processingStatus: refused ? "error" : mapProcessingStatus(file.processingStatus),
    // Demo project only: suggested initial quantity (undefined elsewhere).
    demoQuantity: file.demoQuantity,
    parts: parts.map((part, index) => ({
      width: Math.round(part.width * 10) / 10,
      height: Math.round(part.height * 10) / 10,
      // Display color persisted at import; deterministic fallback for
      // legacy files so the list matches the live view and result SVG.
      color: resolvePartColor(part, file.slug, index),
    })),
    // Purge 24 h (D-PRV-10) : géométrie/blobs purgés → l'UI affiche
    // « expiré » et masque compteur/preview. Champs additifs.
    expired: Boolean(file.purgedAt),
    uploadAt: file.uploadAt ?? null,
    // Lot 2c : constats d'import (perte de matière, unité supposée, tracés
    // ouverts) et refus de la garde du lot 2a. Champs ADDITIFS — les
    // fichiers importés avant n'en ont pas et s'affichent sans.
    findings: file.importReport?.findings ?? [],
    importRefusal: file.importRefusal ?? null,
  };
};

const FILE_MAPPERS = {
  bin: mapBinFileToUi,
};

/**
 * Jobs of a domain for a user (optionally scoped to a project), newest
 * first. Backs the results endpoints.
 */
export async function listJobs(domain, userId, projectSlug) {
  const db = await connectDB();
  return db
    .collection(domain.jobsCollection)
    .find({
      ownerId: userId,
      ...(projectSlug && { [domain.projectSlugField]: projectSlug }),
    })
    .sort({ createdAt: -1 })
    .toArray();
}

/**
 * Nombre de fichiers NOMMÉS dans le slug d'un job (lot E2).
 *
 * L'éclatement du lot E1 peut produire dix-sept fiches d'une pièce : le slug
 * — donc le nom du DXF résultat que l'utilisateur télécharge — concaténait
 * les dix-sept jetons et devenait illisible (mesuré : 380 caractères). On en
 * garde trois et on compte le reste. L'unicité ne repose pas sur les noms
 * mais sur le suffixe aléatoire.
 */
export const JOB_SLUG_MAX_FILES = 3;

export function buildJobSlug(domain, fileMetadata) {
  const tokens = fileMetadata.map((file) => {
    const token = file.simpleName
      ? standardSlugify(file.simpleName, { keepCase: false })
      : String(file.slug || "f").replace(/\.[^.]+$/, "");
    return token + "_" + file.count;
  });
  const shown = tokens.slice(0, JOB_SLUG_MAX_FILES);
  // « … » ne va pas dans un nom de fichier ni dans une URL : le reste est
  // compté en clair (`and14more`), lisible et sûr partout.
  const rest = tokens.length - shown.length;
  const parts = rest > 0 ? [...shown, `and${rest}more`] : shown;
  return `${domain.jobSlugPrefix}${parts.join("-")}-${generateRandomString(6)}`;
}

/**
 * Subscription / free-quota gate + vault gate + job insertion, shared by the
 * nest routes. The route validates the domain-specific
 * params and builds fileMetadata beforehand; `extraFields` carries
 * domain-only job fields (e.g. { priority } for bin). A route that already
 * gated the user itself (bin needs the charge to pick the compute tier)
 * passes it via `charge` so the quota is not consumed twice.
 */
export async function enqueueNestingJob(
  domain,
  { userId, projectSlug, fileMetadata, params, extraFields = {}, charge = null, skipVaultGate = false, initialStatus = "pending", localConfig = null }
) {
  const db = await connectDB();

  // Consumes a unit only once the request is fully validated. The charge is
  // stored on the job so the worker can refund it if the nesting fails.
  const finalCharge = charge ?? (await assertCanNest(userId));

  // R-1 (audit 2026-08-31 §R-1) : les échecs APRÈS la charge mais AVANT
  // l'insertion (vault_locked, Mongo indisponible) brûlaient une unité
  // sans qu'aucun job n'existe — le refund worker ne peut pas les voir.
  // Refund puis relance de l'erreur ; le drapeau sur l'objet charge rend
  // le refund idempotent vis-à-vis du catch de la route appelante.
  try {
    // Encrypted vaults must be unlocked before a job can be enqueued — the
    // workers need an active session to read the source files. Also refreshes
    // the sliding TTL so the session outlives the job. Demo jobs skip this:
    // the demo files are plaintext and shared, the user's vault is irrelevant.
    if (!skipVaultGate) {
      await requireFileAccess(userId);
    }

    const jobSlug = buildJobSlug(domain, fileMetadata);

    await db.collection(domain.jobsCollection).insertOne({
      slug: jobSlug,
      [domain.projectSlugField]: projectSlug,
      files: fileMetadata,
      params: params,
      status: initialStatus,
      // J-090 : profil compute imposé serveur pour un job 100 % navigateur
      // (null pour les jobs classiques — champ absent de la projection).
      ...(localConfig ? { localConfig } : {}),
      ...extraFields,
      createdAt: new Date(),
      ownerId: userId,
      charge: finalCharge,
    });
  } catch (error) {
    await refundNestCharge(userId, finalCharge).catch(() => {});
    throw error;
  }

  return {
    slug: buildJobSlug(domain, fileMetadata),
  };
}
