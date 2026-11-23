#!/usr/bin/env node
// Suma un repositorio a los reportes: lo que se hace una vez por repo (no por PC).
//   1. .github/workflows/reporte.yml (el de ejemplo/, con la rama principal del repo);
//   2. .github/reporte.json con los archivos que explican el repo y existen, si no hay;
//   3. el secreto BRAIN_RAW_TOKEN en el repo, comprobando antes que el token puede
//      leer el vault;
//   4. con --subir, commit y push de esos archivos (el push ya genera el primer reporte).
//
// Uso:
//   node sumar-repo.cjs <ruta del clon> [--subir] [--sin-secreto] [--cambiar-secreto]
//
// El token se toma de la variable de entorno BRAIN_RAW_TOKEN o, si no está, del
// portapapeles (cópialo antes, por ejemplo del cofre). Nunca se muestra: va a `gh`
// por stdin y, si salió del portapapeles, el portapapeles se vacía después.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { repoDeRemoto } = require("./scripts/fichas.cjs");
const { leeConfig, PREDETERMINADA } = require("./scripts/config.cjs");

const RAIZ = __dirname;
const SECRETO = "BRAIN_RAW_TOKEN";
const WORKFLOW = ".github/workflows/reporte.yml";
const CONFIG = ".github/reporte.json";
const REUTILIZABLE = "stysmrt/reportes-actions/.github/workflows/reporte.yml";
const CANDIDATOS = [
  ["README.md", "Qué es y cómo se instala"],
  ["AGENTS.md", "Convenciones para trabajar en el repo (también para una IA)"],
  ["CLAUDE.md", "Instrucciones para Claude Code"],
  ["CHANGELOG.md", "Cambios por versión"],
  ["docs", "Documentación"],
];

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

function argumentos(argv) {
  const o = { dir: null, subir: false, secreto: true, cambiar: false };
  for (const a of argv) {
    if (a === "--subir") o.subir = true;
    else if (a === "--sin-secreto") o.secreto = false;
    else if (a === "--cambiar-secreto") o.cambiar = true;
    else if (a.startsWith("--")) throw new Error(`no entiendo «${a}»`);
    else if (!o.dir) o.dir = path.resolve(a);
    else throw new Error("una sola ruta");
  }
  if (!o.dir) throw new Error("uso: node sumar-repo.cjs <ruta del clon> [--subir] [--sin-secreto] [--cambiar-secreto]");
  if (!fs.existsSync(path.join(o.dir, ".git"))) throw new Error(`${o.dir} no es un repositorio git`);
  return o;
}

function ramaPrincipal(repo, dir) {
  try {
    return run("gh", ["repo", "view", repo, "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"]);
  } catch {
    return run("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
  }
}

/** El workflow: lo crea, o revisa el que hay. Devuelve si lo escribió. */
function workflow(dir, rama) {
  const abs = path.join(dir, ...WORKFLOW.split("/"));
  if (fs.existsSync(abs)) {
    const t = fs.readFileSync(abs, "utf8");
    if (!t.includes(REUTILIZABLE)) console.log(`aviso: ${WORKFLOW} existe pero no llama a ${REUTILIZABLE}; no lo toco`);
    else if (!new RegExp(`branches:\\s*\\[\\s*${rama}\\s*\\]`).test(t)) console.log(`aviso: ${WORKFLOW} no reacciona a la rama principal «${rama}»; revísalo`);
    else console.log(`${WORKFLOW}: ya está`);
    return false;
  }
  const ejemplo = fs.readFileSync(path.join(RAIZ, "ejemplo", "reporte.yml"), "utf8")
    .replace(/^# Copia este archivo.*\n/m, "# Reportes al vault (stysmrt/reportes-actions); lo añadió sumar-repo.cjs.\n")
    .replace(/branches: \[main\]/, `branches: [${rama}]`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, ejemplo, "utf8");
  console.log(`${WORKFLOW}: creado (rama ${rama})`);
  return true;
}

function configReporte(dir) {
  const abs = path.join(dir, ...CONFIG.split("/"));
  if (fs.existsSync(abs)) {
    console.log(`${CONFIG}: ya está`);
    return false;
  }
  const dondeMirar = CANDIDATOS.filter(([ruta]) => fs.existsSync(path.join(dir, ruta))).map(([ruta, para]) => ({ para, ruta }));
  if (!dondeMirar.length) {
    console.log(`${CONFIG}: no lo creo (no hay README, AGENTS.md ni docs/ que enlazar)`);
    return false;
  }
  fs.writeFileSync(abs, JSON.stringify({ dondeMirar }, null, 2) + "\n", "utf8");
  console.log(`${CONFIG}: creado con ${dondeMirar.map((d) => d.ruta).join(", ")}`);
  return true;
}

function portapapeles(accion) {
  if (process.platform !== "win32") return null;
  const cmd = accion === "leer" ? "Get-Clipboard -Raw" : "Set-Clipboard -Value ' '";
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8" });
  return r.status === 0 ? (r.stdout || "").trim() : null;
}

async function secreto(repo, o) {
  const hay = run("gh", ["secret", "list", "-R", repo]).split("\n").some((l) => l.split(/\s/)[0] === SECRETO);
  if (hay && !o.cambiar) {
    console.log(`secreto ${SECRETO}: ya está en ${repo} (--cambiar-secreto para reemplazarlo)`);
    return;
  }
  let token = (process.env[SECRETO] || "").trim();
  const delPortapapeles = !token;
  if (delPortapapeles) token = portapapeles("leer") || "";
  if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(token)) {
    throw new Error(`no encuentro un token de GitHub en ${delPortapapeles ? "el portapapeles" : SECRETO}: copia el token (github_pat_…) y vuelve a correrlo`);
  }
  const brain = (leeConfig() || PREDETERMINADA).brain;
  const r = await fetch(`https://api.github.com/repos/${brain}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "reportes-actions" },
  });
  if (r.status !== 200) throw new Error(`el token no puede leer ${brain} (HTTP ${r.status}): ¿caducó o es de otro repo? No guardo nada`);
  const s = spawnSync("gh", ["secret", "set", SECRETO, "-R", repo], { input: token, encoding: "utf8" });
  if (s.status !== 0) throw new Error(`gh secret set falló: ${(s.stderr || "").trim()}`);
  if (delPortapapeles) portapapeles("vaciar");
  console.log(`secreto ${SECRETO}: guardado en ${repo} (el token puede leer ${brain})${delPortapapeles ? "; portapapeles vaciado" : ""}`);
}

function subir(dir, rama, archivos) {
  const actual = run("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
  if (actual !== rama) {
    console.log(`--subir: estás en «${actual}», no en «${rama}»; súbelo con tu flujo (rama y PR)`);
    return;
  }
  run("git", ["-C", dir, "add", "--", ...archivos]);
  if (spawnSync("git", ["-C", dir, "diff", "--cached", "--quiet"]).status === 0) {
    console.log("--subir: no hay nada nuevo que subir");
    return;
  }
  run("git", ["-C", dir, "commit", "-m", "Reportes al vault (stysmrt/reportes-actions)"]);
  run("git", ["-C", dir, "push", "origin", `HEAD:${rama}`]);
  console.log(`--subir: commit y push a ${rama}; este push genera el primer reporte`);
}

async function main() {
  const o = argumentos(process.argv.slice(2));
  const remoto = run("git", ["-C", o.dir, "remote", "get-url", "origin"]);
  const repo = repoDeRemoto(remoto);
  if (!repo) throw new Error(`el remoto origin no es de GitHub: ${remoto.replace(/\/\/[^@/]+@/, "//")}`);
  const rama = ramaPrincipal(repo, o.dir);
  console.log(`repositorio: ${repo} (rama principal ${rama})`);

  workflow(o.dir, rama);
  configReporte(o.dir);
  if (o.secreto) await secreto(repo, o);

  const pendientes = [WORKFLOW, CONFIG].filter((f) => {
    const st = run("git", ["-C", o.dir, "status", "--porcelain", "--", f]);
    return st !== "";
  });
  if (o.subir) subir(o.dir, rama, pendientes);
  else if (pendientes.length) console.log(`falta subir: ${pendientes.join(", ")} (commit y push a ${rama}, o --subir)`);
  console.log("el inventario de cada PC verá este clon en su próxima pasada (o: Start-ScheduledTask \"Inventario de repos\")");
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
