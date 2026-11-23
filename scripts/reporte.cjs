#!/usr/bin/env node
// reportes-actions: el reporte de cada push a `main`, como notas del vault central
// (stysmrt/brain-raw, 500-proyectos/100-reportes):
//   - <repo>/<AAAA-MM-DD>.md: una nota por día; el primer push la crea y los
//     siguientes le añaden una sección;
//   - <repo>/<repo>.md: la ficha del proyecto (fichas.cjs); este script escribe su
//     bloque `reporte` (enlace, último reporte, «Dónde mirar más»).
// Solo con lo que dice git, sin IA. Sin dependencias: lo corre el Node del runner.
//
// Entorno (lo pone el workflow reutilizable .github/workflows/reporte.yml; el
// directorio actual es el clon del repositorio que hizo el push):
//   REPO        owner/nombre (GITHUB_REPOSITORY)
//   RAMA        la rama (GITHUB_REF_NAME)
//   SHA         el último commit del push
//   ANTES       el commit anterior al push (github.event.before); ceros si es nueva
//   BRAIN_DIR   el clon de brain-raw donde se escribe
//   CARPETA     la carpeta de reportes en el vault (500-proyectos/100-reportes)
//   REPORTE_TZ  la zona horaria de la fecha y la hora (America/Lima)
//   CONFIG      el archivo con «Dónde mirar más» (.github/reporte.json), opcional
//   SIN_PUSH=1  escribe las notas y no hace commit ni push (para probar en local)

"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const F = require("./fichas.cjs");

const MAX_COMMITS = 30;
const MAX_ARCHIVOS = 10;

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function existeCommit(dir, ref) {
  try {
    git(["cat-file", "-e", `${ref}^{commit}`], dir);
    return true;
  } catch {
    return false;
  }
}

/** Lo que trajo el push, leído del clon del repositorio. */
function elPush(repoDir, antes, sha) {
  const valeAntes = !!antes && !/^0+$/.test(antes) && existeCommit(repoDir, antes);
  const rango = valeAntes ? [`${antes}..${sha}`] : ["-1", sha];
  const commits = git(["log", "--format=%H%x09%s", ...rango], repoDir)
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("\t");
      return { sha: l.slice(0, i), asunto: l.slice(i + 1) };
    });
  const base = valeAntes ? antes : `${sha}~1`;
  const tieneBase = existeCommit(repoDir, base);
  const stat = tieneBase ? git(["diff", "--shortstat", base, sha], repoDir) : "";
  const archivos = tieneBase ? git(["diff", "--name-only", base, sha], repoDir).split("\n").filter(Boolean) : [];
  return { commits, stat, archivos, valeAntes };
}

/** «5 files changed, 120 insertions(+), 8 deletions(-)» → «5 (+120 −8)». */
function resumenStat(stat) {
  if (!stat) return "";
  const n = (re) => (stat.match(re) || [, "0"])[1];
  return `${n(/(\d+) files? changed/)} (+${n(/(\d+) insertions?/)} −${n(/(\d+) deletions?/)})`;
}

function seccionPush({ repo, rama, hora, antes, sha, push }) {
  const url = `https://github.com/${repo}`;
  const n = push.commits.length;
  const lineas = [`## ${hora} · ${rama} · ${n} commit${n === 1 ? "" : "s"}`, ""];
  for (const c of push.commits.slice(0, MAX_COMMITS)) {
    lineas.push(`- [${c.sha.slice(0, 7)}](${url}/commit/${c.sha}) ${c.asunto}`);
  }
  if (n > MAX_COMMITS) lineas.push(`- … y ${n - MAX_COMMITS} más`);
  if (push.archivos.length) {
    const lista = push.archivos.slice(0, MAX_ARCHIVOS).map((a) => `\`${a}\``).join(", ");
    const mas = push.archivos.length > MAX_ARCHIVOS ? `, … y ${push.archivos.length - MAX_ARCHIVOS} más` : "";
    lineas.push(`- Archivos: ${resumenStat(push.stat)}: ${lista}${mas}`);
  }
  if (push.valeAntes) lineas.push(`- [Comparar](${url}/compare/${antes.slice(0, 12)}...${sha.slice(0, 12)})`);
  return lineas.join("\n") + "\n";
}

function notaDelDia({ repo, nombre, fecha, sha, id, relFicha, seccion }) {
  const fm = [
    "---",
    `repo: ${repo}`,
    `fecha: ${fecha}`,
    `ultimo_commit: ${sha.slice(0, 7)}`,
    "pushes: 1",
    "tags:",
    "  - reporte",
    `  - ${nombre.toLowerCase().replace(/[^a-z0-9_\-/]/g, "-")}`,
    `created: ${fecha}`,
    `id: "${id}"`,
    "creado_por: GitHub Actions",
    "---",
  ];
  const cuerpo = [`# ${nombre} · ${fecha}`, "", `Ficha del proyecto: ${F.enlaceNota(relFicha, nombre)}`, ""];
  return `${fm.join("\n")}\n${cuerpo.join("\n")}\n${seccion}`;
}

function notaConOtroPush(texto, sha, seccion) {
  let t = F.ponPropiedad(texto, "ultimo_commit", sha.slice(0, 7));
  t = t.replace(/^pushes:\s*(\d+)\s*$/m, (_, n) => `pushes: ${Number(n) + 1}`);
  if (!t.endsWith("\n")) t += "\n";
  return `${t}\n${seccion}`;
}

function contenidoReporte({ repo, rama, relDia, fecha, ultimo, dondeMirar }) {
  const url = `https://github.com/${repo}`;
  const l = [
    `- Repositorio: ${url}`,
    `- Último reporte: ${F.enlaceNota(relDia, fecha)} · [${ultimo.sha.slice(0, 7)}](${url}/commit/${ultimo.sha}) ${ultimo.asunto}`,
  ];
  if (dondeMirar.length) {
    l.push("", "## Dónde mirar más", "");
    for (const d of dondeMirar) l.push(`- ${d.para}: [\`${d.ruta}\`](${url}/blob/${rama}/${d.ruta})`);
  }
  return l.join("\n");
}

function leeConfig(archivo) {
  if (!archivo || !fs.existsSync(archivo)) return [];
  const c = JSON.parse(fs.readFileSync(archivo, "utf8"));
  return Array.isArray(c.dondeMirar) ? c.dondeMirar.filter((d) => d && d.ruta && d.para) : [];
}

/** Escribe la nota del día y la ficha en brainDir. Devuelve las rutas tocadas. */
function aplicar({ brainDir, carpeta, repo, rama, nombre, t, sha, seccion, ultimo, dondeMirar }) {
  const abs = (rel) => path.join(brainDir, ...rel.split("/"));
  const relDia = path.posix.join(carpeta, nombre, `${t.fecha}.md`);
  const relFicha = F.rutaFicha(carpeta, nombre);
  fs.mkdirSync(path.dirname(abs(relDia)), { recursive: true });

  if (fs.existsSync(abs(relDia))) {
    fs.writeFileSync(abs(relDia), notaConOtroPush(fs.readFileSync(abs(relDia), "utf8"), sha, seccion), "utf8");
  } else {
    const id = F.idLibre(brainDir, t.sello);
    fs.writeFileSync(abs(relDia), notaDelDia({ repo, nombre, fecha: t.fecha, sha, id, relFicha, seccion }), "utf8");
  }

  const reporte = contenidoReporte({ repo, rama, relDia, fecha: t.fecha, ultimo, dondeMirar });
  let ficha;
  if (fs.existsSync(abs(relFicha))) {
    ficha = F.reemplazaBloque(fs.readFileSync(abs(relFicha), "utf8"), "reporte", reporte);
  } else {
    const id = F.idLibre(brainDir, t.sello);
    const clones = F.contenidoClones(F.leeMaquinas(brainDir, carpeta), repo);
    ficha = F.fichaNueva({ repo, nombre, fecha: t.fecha, id, creadoPor: "GitHub Actions", reporte, clones });
  }
  ficha = F.ponPropiedad(ficha, "ultimo_reporte", t.fecha);
  ficha = F.ponPropiedad(ficha, "ultimo_commit", sha.slice(0, 7));
  fs.writeFileSync(abs(relFicha), ficha, "utf8");
  return [relDia, relFicha];
}

/** Commit y push; si otro subió a la vez, se vuelve a escribir encima de lo suyo. */
function subir(brainDir, escribir, mensaje) {
  const rama = git(["rev-parse", "--abbrev-ref", "HEAD"], brainDir);
  for (let intento = 1; intento <= 5; intento++) {
    const rels = escribir();
    git(["add", "--", ...rels], brainDir);
    git(["commit", "-m", mensaje], brainDir);
    try {
      git(["push", "origin", `HEAD:${rama}`], brainDir);
      return;
    } catch {
      console.log(`push rechazado (intento ${intento}): se escribe otra vez sobre lo último de brain-raw`);
      git(["fetch", "--depth", "1", "origin", rama], brainDir);
      git(["reset", "--hard", "FETCH_HEAD"], brainDir);
    }
  }
  throw new Error("no se pudo subir el reporte después de 5 intentos");
}

function main() {
  const env = process.env;
  const repo = env.REPO;
  const sha = env.SHA;
  const brainDir = env.BRAIN_DIR;
  if (!repo || !sha || !brainDir) {
    console.error("faltan REPO, SHA o BRAIN_DIR");
    process.exit(2);
  }
  const rama = env.RAMA || "main";
  const antes = env.ANTES || "";
  const carpeta = env.CARPETA || "500-proyectos/100-reportes";
  const nombre = repo.split("/")[1];
  const t = F.ahora(env.REPORTE_TZ || "America/Lima");

  const push = elPush(process.cwd(), antes, sha);
  const seccion = seccionPush({ repo, rama, hora: t.hora, antes, sha, push });
  const ultimo = push.commits[0] || { sha, asunto: "" };
  const dondeMirar = leeConfig(env.CONFIG);
  const escribir = () => aplicar({ brainDir, carpeta, repo, rama, nombre, t, sha, seccion, ultimo, dondeMirar });

  if (env.SIN_PUSH === "1") {
    console.log(`reporte: ${escribir().join(", ")} (${push.commits.length} commits)`);
    return;
  }
  subir(brainDir, escribir, `Reporte: ${nombre} ${t.fecha} ${t.hora} (${sha.slice(0, 7)})`);
  console.log(`reporte: ${nombre} ${t.fecha} (${push.commits.length} commits)`);
}

if (require.main === module) main();

module.exports = { resumenStat, seccionPush, notaDelDia, notaConOtroPush, contenidoReporte };
