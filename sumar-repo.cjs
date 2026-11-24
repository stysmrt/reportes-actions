#!/usr/bin/env node
// Suma un repositorio a los reportes: lo que se hace una vez por repo (no por PC).
//   1. .github/workflows/reporte.yml (el de ejemplo/, con la rama principal del repo);
//   2. .github/reporte.json con los archivos que explican el repo y existen, si no hay;
//   3. el secreto BRAIN_RAW_TOKEN en el repo, comprobando antes que el token puede
//      leer el vault;
//   4. con --subir, commit y push de esos archivos (el push ya genera el primer reporte).
//
// Uso:
//   node sumar-repo.cjs <ruta del clon> [<ruta>...] [--subir] [--sin-secreto] [--cambiar-secreto]
//   node sumar-repo.cjs --guardar-token     guarda el token del portapapeles, cifrado (DPAPI)
//   node sumar-repo.cjs --borrar-token      borra el token guardado
//
// El token se toma, en este orden, de la variable de entorno BRAIN_RAW_TOKEN, del
// guardado con --guardar-token (~/.reportes-actions.token, cifrado con tu usuario de
// Windows) o del portapapeles. Nunca se muestra: va a `gh` por stdin y, si salió del
// portapapeles, el portapapeles se vacía después.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { repoDeRemoto } = require("./scripts/fichas.cjs");
const { leeConfig, PREDETERMINADA } = require("./scripts/config.cjs");
const T = require("./scripts/token.cjs");

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
  const o = { dirs: [], subir: false, secreto: true, cambiar: false, token: null };
  for (const a of argv) {
    if (a === "--guardar-token") o.token = "guardar";
    else if (a === "--borrar-token") o.token = "borrar";
    else if (a === "--subir") o.subir = true;
    else if (a === "--sin-secreto") o.secreto = false;
    else if (a === "--cambiar-secreto") o.cambiar = true;
    else if (a.startsWith("--")) throw new Error(`no entiendo «${a}»`);
    else o.dirs.push(path.resolve(a));
  }
  if (o.token) return o;
  if (!o.dirs.length) throw new Error("uso: node sumar-repo.cjs <ruta del clon> [<ruta>...] [--subir] [--sin-secreto] [--cambiar-secreto]");
  for (const d of o.dirs) if (!fs.existsSync(path.join(d, ".git"))) throw new Error(`${d} no es un repositorio git`);
  return o;
}

// El token se lee una sola vez para todos los repos: el cofre de la barra vacía el
// portapapeles a los 30 s.
let tokenLeido = null;

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

async function secreto(repo, o) {
  const hay = run("gh", ["secret", "list", "-R", repo]).split("\n").some((l) => l.split(/\s/)[0] === SECRETO);
  if (hay && !o.cambiar) {
    console.log(`secreto ${SECRETO}: ya está en ${repo} (--cambiar-secreto para reemplazarlo)`);
    return;
  }
  const brain = (leeConfig() || PREDETERMINADA).brain;
  if (!tokenLeido) {
    let token = (process.env[SECRETO] || "").trim();
    let origen = `la variable ${SECRETO}`;
    if (!token) {
      token = T.leerGuardado();
      origen = `guardado en ${T.ARCHIVO}`;
    }
    if (!token) {
      token = T.portapapeles("leer") || "";
      origen = "el portapapeles";
      if (!T.esToken(token)) {
        throw new Error(`no hay token: guárdalo una vez con --guardar-token, o cópialo (github_pat_…) y corre esto antes de 30 s (el cofre vacía el portapapeles)`);
      }
      T.portapapeles("vaciar");
    }
    if (!T.esToken(token)) throw new Error(`${origen} no tiene forma de token de GitHub (github_pat_…)`);
    const estado = await T.puedeLeer(token, brain);
    if (estado !== 200) throw new Error(`el token (${origen}) no puede leer ${brain} (HTTP ${estado}): ¿caducó? No guardo nada`);
    tokenLeido = token;
    console.log(`token (${origen}): puede leer ${brain}`);
  }
  const s = spawnSync("gh", ["secret", "set", SECRETO, "-R", repo], { input: tokenLeido, encoding: "utf8" });
  if (s.status !== 0) throw new Error(`gh secret set falló: ${(s.stderr || "").trim()}`);
  console.log(`secreto ${SECRETO}: guardado en ${repo}`);
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

async function token(accion) {
  if (accion === "borrar") {
    console.log(T.borrar() ? `token borrado: ${T.ARCHIVO}` : "no había token guardado");
    return;
  }
  const t = T.portapapeles("leer") || "";
  if (!T.esToken(t)) throw new Error("no hay un token (github_pat_…) en el portapapeles: cópialo y corre esto antes de 30 s");
  T.portapapeles("vaciar");
  const brain = (leeConfig() || PREDETERMINADA).brain;
  const estado = await T.puedeLeer(t, brain);
  if (estado !== 200) throw new Error(`ese token no puede leer ${brain} (HTTP ${estado}): ¿caducó o es otro? No guardo nada`);
  const archivo = T.guardar(t);
  if (T.leerGuardado() !== t) throw new Error("el token guardado no se pudo volver a leer igual");
  console.log(`token guardado cifrado (DPAPI, solo tu usuario en este PC): ${archivo}`);
  console.log(`puede leer ${brain}; portapapeles vaciado`);
}

async function main() {
  const o = argumentos(process.argv.slice(2));
  if (o.token) return token(o.token);
  let fallos = 0;
  for (const dir of o.dirs) {
    try {
      await sumar({ ...o, dir });
    } catch (e) {
      console.error(`error en ${dir}: ${e.message}`);
      fallos++;
      // Sin token válido no tiene sentido seguir con los demás.
      if (/token/.test(e.message) && !tokenLeido) break;
    }
    console.log("");
  }
  if (fallos) process.exit(1);
}

async function sumar(o) {
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
  // Solo errores de argumentos: los de cada repo ya se dijeron en main.
  console.error(`error: ${e.message}`);
  process.exit(1);
});
