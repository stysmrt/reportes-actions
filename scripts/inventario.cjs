#!/usr/bin/env node
// reportes-actions: qué repositorios git hay en esta máquina y en qué ruta. Escribe
// <carpeta>/maquinas/<PC>.md en brain-raw y vuelve a calcular «Dónde está clonado»
// en las fichas de los proyectos (fichas.cjs). GitHub no sabe dónde está clonado un
// repo: lo tiene que decir cada máquina.
//
// Uso:
//   node inventario.cjs <carpeta> [<carpeta>...] [opciones]
//     --duenos a,b       crea la ficha de los repos de GitHub de estos dueños que
//                        aún no la tienen (sin esto solo actualiza las que hay)
//     --maquina NOMBRE   el nombre de la máquina (por defecto, el del PC)
//     --profundidad N    cuántas carpetas baja buscando repos (por defecto 5)
//     --vault RUTA       escribe en esa carpeta y no hace commit ni push (pruebas)
//     --brain owner/rep  el vault en GitHub (por defecto stysmrt/brain-raw)
//     --reportes RUTA    la carpeta en el vault (por defecto 500-proyectos/100-reportes)
//     --tz ZONA          la zona horaria (por defecto America/Lima)
//
// Sin --vault, clona brain-raw en una carpeta temporal (solo la carpeta de reportes,
// con las credenciales de git de esta máquina), escribe, hace commit y push, y la
// borra. Nunca toca el vault en el que trabaja el usuario. Si nada cambió desde el
// último inventario (aparte de la hora), no sube nada.

"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const F = require("./fichas.cjs");

const SALTA = new Set([
  "node_modules", "target", "dist", "build", "out", "vendor", "venv", "__pycache__",
  "AppData", "$RECYCLE.BIN", "System Volume Information", "Windows", "Program Files",
  "Program Files (x86)", "ProgramData",
]);

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitO(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

function argumentos(argv) {
  const o = { raices: [], duenos: [], maquina: os.hostname(), profundidad: 5, vault: null,
    brain: "stysmrt/brain-raw", reportes: "500-proyectos/100-reportes", tz: "America/Lima" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      if (i + 1 >= argv.length) throw new Error(`falta el valor de ${a}`);
      return argv[++i];
    };
    if (a === "--duenos") o.duenos = v().split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a === "--maquina") o.maquina = v();
    else if (a === "--profundidad") o.profundidad = Number(v());
    else if (a === "--vault") o.vault = v();
    else if (a === "--brain") o.brain = v();
    else if (a === "--reportes") o.reportes = v();
    else if (a === "--tz") o.tz = v();
    else if (a.startsWith("--")) throw new Error(`opción desconocida: ${a}`);
    else o.raices.push(path.resolve(a));
  }
  if (!o.raices.length) throw new Error("uso: node inventario.cjs <carpeta> [<carpeta>...] [--duenos a,b] [--vault RUTA]");
  if (!/^[\w.-]+$/.test(o.maquina)) throw new Error(`nombre de máquina no válido para una nota: ${o.maquina}`);
  return o;
}

/** Las carpetas con `.git` (carpeta o archivo) bajo cada raíz; no entra en un repo. */
function buscaRepos(raices, profundidad) {
  const repos = [];
  const recorre = (dir, nivel) => {
    let entradas;
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entradas.some((e) => e.name === ".git")) {
      repos.push(dir);
      return;
    }
    if (nivel >= profundidad) return;
    for (const e of entradas) {
      if (!e.isDirectory() || e.name.startsWith(".") || SALTA.has(e.name)) continue;
      recorre(path.join(dir, e.name), nivel + 1);
    }
  };
  for (const r of raices) recorre(r, 0);
  return [...new Set(repos)].sort((a, b) => a.localeCompare(b));
}

/**
 * El remoto y la rama leídos de los archivos de `.git`, sin ejecutar git: para los
 * repos que git no quiere abrir (carpeta de otro usuario de Windows, `safe.directory`).
 * Así no se salta esa protección y el repo igual se reconoce.
 */
function leeDeArchivos(dir) {
  try {
    let gitDir = path.join(dir, ".git");
    if (fs.statSync(gitDir).isFile()) {
      const m = fs.readFileSync(gitDir, "utf8").match(/^gitdir:\s*(.+)$/m);
      if (!m) return {};
      gitDir = path.resolve(dir, m[1].trim());
    }
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").match(/^ref:\s*refs\/heads\/(.+)$/m);
    let config = "";
    try {
      config = fs.readFileSync(path.join(gitDir, "config"), "utf8");
    } catch {}
    const url = config.match(/\[remote "origin"\][^[]*?^\s*url\s*=\s*(.+)$/m);
    return { rama: head ? head[1].trim() : null, url: url ? url[1].trim() : null };
  } catch {
    return {};
  }
}

function datosRepo(dir) {
  const archivos = leeDeArchivos(dir);
  const remotoUrl = gitO(["remote", "get-url", "origin"], dir) ?? archivos.url ?? null;
  const repo = F.repoDeRemoto(remotoUrl);
  const commit = gitO(["log", "-1", "--format=%h %cs"], dir);
  const estado = gitO(["status", "--porcelain"], dir);
  return {
    ruta: dir,
    repo,
    remoto: repo ? null : F.remotoSinCredenciales(remotoUrl),
    rama: gitO(["rev-parse", "--abbrev-ref", "HEAD"], dir) ?? archivos.rama ?? null,
    commit,
    sinCommit: estado === null ? "?" : String(estado.split("\n").filter(Boolean).length),
  };
}

const sinHora = (texto) => texto.replace(/^actualizado:.*$/m, "");

/** Escribe la nota de la máquina, crea las fichas que faltan y recalcula los clones. */
function aplicar(brainDir, o, filas, t) {
  const abs = (rel) => path.join(brainDir, ...rel.split("/"));
  const relMaquina = path.posix.join(o.reportes, F.MAQUINAS, `${o.maquina}.md`);
  fs.mkdirSync(path.dirname(abs(relMaquina)), { recursive: true });

  const vieja = fs.existsSync(abs(relMaquina)) ? fs.readFileSync(abs(relMaquina), "utf8") : null;
  const id = (vieja && F.propiedad(vieja, "id")) || F.idLibre(brainDir, t.sello);
  const fecha = (vieja && F.propiedad(vieja, "created")) || t.fecha;
  const nueva = F.notaMaquina({ maquina: o.maquina, actualizado: t.fechaHora, raices: o.raices, filas, fecha, id });
  const cambios = [];
  if (vieja === null || sinHora(vieja) !== sinHora(nueva)) {
    fs.writeFileSync(abs(relMaquina), nueva, "utf8");
    cambios.push(relMaquina);
  }

  const hay = F.fichas(brainDir, o.reportes);
  for (const f of filas) {
    if (!f.repo || hay.has(f.repo.toLowerCase())) continue;
    if (!o.duenos.includes(f.repo.split("/")[0].toLowerCase())) continue;
    const nombre = f.repo.split("/")[1];
    const rel = F.rutaFicha(o.reportes, nombre);
    if (fs.existsSync(abs(rel))) {
      console.log(`aviso: ${rel} ya es la ficha de otro repositorio; ${f.repo} queda sin ficha`);
      continue;
    }
    fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
    const idF = F.idLibre(brainDir, t.sello);
    fs.writeFileSync(abs(rel), F.fichaNueva({ repo: f.repo, nombre, fecha: t.fecha, id: idF,
      creadoPor: "Inventario de repos", reporte: F.reporteSinReportes(f.repo), clones: "" }), "utf8");
    hay.set(f.repo.toLowerCase(), { rel, repo: f.repo });
    cambios.push(rel);
  }

  if (!cambios.length) return [];
  for (const rel of F.actualizaClones(brainDir, o.reportes)) if (!cambios.includes(rel)) cambios.push(rel);
  return cambios;
}

function subir(o, filas, t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inventario-"));
  try {
    git(["clone", "--depth", "1", "--filter=blob:none", "--sparse", `https://github.com/${o.brain}.git`, tmp], os.tmpdir());
    git(["sparse-checkout", "set", o.reportes], tmp);
    const rama = git(["rev-parse", "--abbrev-ref", "HEAD"], tmp);
    for (let intento = 1; intento <= 5; intento++) {
      const cambios = aplicar(tmp, o, filas, t);
      if (!cambios.length) {
        console.log("inventario: nada cambió desde el último; no se sube nada");
        return;
      }
      git(["add", "--sparse", "--", ...cambios], tmp);
      git(["commit", "-m", `Inventario: ${o.maquina} ${t.fecha} ${t.hora} (${filas.length} repos)`], tmp);
      try {
        git(["push", "origin", `HEAD:${rama}`], tmp);
        console.log(`inventario: ${filas.length} repos; subido ${cambios.join(", ")}`);
        return;
      } catch {
        console.log(`push rechazado (intento ${intento}): se escribe otra vez sobre lo último de brain-raw`);
        git(["fetch", "--depth", "1", "origin", rama], tmp);
        git(["reset", "--hard", "FETCH_HEAD"], tmp);
      }
    }
    throw new Error("no se pudo subir el inventario después de 5 intentos");
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      console.log(`aviso: no se pudo borrar ${tmp}`);
    }
  }
}

function main() {
  let o;
  try {
    o = argumentos(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const t = F.ahora(o.tz);
  const filas = buscaRepos(o.raices, o.profundidad).map(datosRepo);
  if (o.vault) {
    const cambios = aplicar(path.resolve(o.vault), o, filas, t);
    console.log(`inventario: ${filas.length} repos; ${cambios.length ? `escrito ${cambios.join(", ")}` : "nada cambió"}`);
    return;
  }
  subir(o, filas, t);
}

if (require.main === module) main();

module.exports = { buscaRepos, datosRepo, aplicar };
