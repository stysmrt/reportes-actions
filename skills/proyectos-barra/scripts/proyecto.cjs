#!/usr/bin/env node
// Skill proyectos-barra: lee las fichas y los reportes de los proyectos del vault
// central (500-proyectos/100-reportes en stysmrt/brain-raw). Solo lee.
//
//   node proyecto.cjs lista                    todos los proyectos con ficha
//   node proyecto.cjs ficha <repo>             la ficha y dónde está en ESTA máquina
//   node proyecto.cjs reportes <repo> [n]      los últimos n reportes diarios (3)
//   node proyecto.cjs maquina [nombre]         los repos de una máquina (esta)
//
// <repo> es el nombre (digisider) o owner/nombre. Lee de GitHub con `gh` (lo más
// nuevo: los reportes los sube GitHub Actions); si no puede, del vault local de
// ~/.reportes-actions.json, que puede estar atrasado si no se hizo git pull.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
// Instalada, la skill lleva su copia de config.cjs (instalar.cjs); en el repo, la de scripts/.
const { leeConfig, PREDETERMINADA } = fs.existsSync(path.join(__dirname, "config.cjs"))
  ? require("./config.cjs")
  : require("../../../scripts/config.cjs");

const c = leeConfig() || { ...PREDETERMINADA };
const MAQUINAS = "maquinas";
let fuente = null;

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 20 * 1024 * 1024 });
}

const ruta = (rel) => rel.split("/").map(encodeURIComponent).join("/");

/** El texto de un archivo del vault, o null si no está. */
function leer(rel) {
  try {
    const t = gh(["api", `repos/${c.brain}/contents/${ruta(rel)}`, "-H", "Accept: application/vnd.github.raw"]);
    fuente = fuente || `GitHub (${c.brain})`;
    return t;
  } catch (e) {
    if (/Not Found|404/.test(String(e.stderr || e.message)) && fuente && fuente.startsWith("GitHub")) return null;
  }
  if (c.vault) {
    const abs = path.join(c.vault, ...rel.split("/"));
    fuente = fuente || `vault local ${c.vault} (puede estar atrasado: los reportes llegan por git pull)`;
    return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  }
  return null;
}

/** Los nombres de una carpeta del vault: [{ nombre, carpeta }]. */
function listar(rel) {
  try {
    const j = JSON.parse(gh(["api", `repos/${c.brain}/contents/${ruta(rel)}`]));
    fuente = fuente || `GitHub (${c.brain})`;
    return j.map((e) => ({ nombre: e.name, carpeta: e.type === "dir" }));
  } catch {}
  if (c.vault) {
    const abs = path.join(c.vault, ...rel.split("/"));
    fuente = fuente || `vault local ${c.vault} (puede estar atrasado: los reportes llegan por git pull)`;
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs, { withFileTypes: true }).map((e) => ({ nombre: e.name, carpeta: e.isDirectory() }));
  }
  throw new Error(`no puedo leer el vault: ni \`gh\` con acceso a ${c.brain} ni "vault" en ~/.reportes-actions.json`);
}

function propiedad(texto, clave) {
  const m = texto.match(new RegExp(`^${clave}:\\s*"?([^"\\n]*)"?\\s*$`, "m"));
  return m ? m[1].trim() : "";
}

/** Las filas de «Dónde está clonado»: [{ maquina, ruta, rama, commit, sinCommit, inventario }]. */
function clones(ficha) {
  const res = [];
  for (const l of ficha.split(/\r?\n/)) {
    const m = l.match(/^\| \[\[([^\]]+)\]\] \| `([^`]+)` \| ([^|]*) \| ([^|]*) \| ([^|]*) \| ([^|]*) \|\s*$/);
    if (m) res.push({ maquina: m[1], ruta: m[2], rama: m[3].trim(), commit: m[4].trim(), sinCommit: m[5].trim(), inventario: m[6].trim() });
  }
  return res;
}

function proyectos() {
  return listar(c.reportes)
    .filter((e) => e.carpeta && e.nombre !== MAQUINAS)
    .map((e) => {
      const texto = leer(`${c.reportes}/${e.nombre}/${e.nombre}.md`);
      return texto ? { carpeta: e.nombre, texto, repo: propiedad(texto, "repo") } : null;
    })
    .filter(Boolean);
}

function busca(nombre) {
  const n = nombre.toLowerCase();
  const todos = proyectos();
  const p = todos.find((x) => x.repo.toLowerCase() === n || x.carpeta.toLowerCase() === n || x.repo.toLowerCase().endsWith(`/${n}`));
  if (!p) {
    console.log(`No hay ficha de «${nombre}». Proyectos con ficha: ${todos.map((x) => x.repo || x.carpeta).join(", ") || "ninguno"}`);
    process.exit(1);
  }
  return p;
}

function aqui(filas) {
  const yo = os.hostname().toLowerCase();
  return filas.filter((f) => f.maquina.toLowerCase() === yo);
}

function main() {
  const [cmd, arg, n] = process.argv.slice(2);
  if (cmd === "lista") {
    const todos = proyectos();
    console.log(`Fuente: ${fuente}\nEsta máquina: ${os.hostname()}\n`);
    for (const p of todos) {
      const f = clones(p.texto);
      const local = aqui(f);
      console.log(`- ${p.repo} (carpeta ${p.carpeta}) · último reporte ${propiedad(p.texto, "ultimo_reporte") || "—"} · commit ${propiedad(p.texto, "ultimo_commit") || "—"}`);
      console.log(`  máquinas: ${f.map((x) => x.maquina).join(", ") || "ninguna en el inventario"}${local.length ? ` · aquí: ${local.map((x) => x.ruta).join(", ")}` : ""}`);
    }
    if (!todos.length) console.log("No hay fichas todavía.");
  } else if (cmd === "ficha" && arg) {
    const p = busca(arg);
    console.log(`Fuente: ${fuente}\nFicha: ${c.reportes}/${p.carpeta}/${p.carpeta}.md\n`);
    console.log(p.texto.trimEnd());
    const local = aqui(clones(p.texto));
    console.log(`\n--- En esta máquina (${os.hostname()}) ---`);
    if (!local.length) console.log("No está clonado aquí según el inventario: consúltalo en GitHub (gh) o clónalo si hace falta.");
    for (const f of local) console.log(`${f.ruta} (${fs.existsSync(f.ruta) ? "existe" : "YA NO EXISTE en el disco"}) · rama ${f.rama} · ${f.commit} · sin commit ${f.sinCommit} · inventario ${f.inventario}`);
  } else if (cmd === "reportes" && arg) {
    const p = busca(arg);
    const cuantos = Math.max(1, Number(n) || 3);
    const dias = listar(`${c.reportes}/${p.carpeta}`)
      .map((e) => e.nombre)
      .filter((x) => /^\d{4}-\d{2}-\d{2}\.md$/.test(x))
      .sort()
      .reverse()
      .slice(0, cuantos);
    console.log(`Fuente: ${fuente}\n`);
    for (const d of dias) console.log(`===== ${c.reportes}/${p.carpeta}/${d}\n${(leer(`${c.reportes}/${p.carpeta}/${d}`) || "").trimEnd()}\n`);
    if (!dias.length) console.log("Sin reportes diarios todavía.");
  } else if (cmd === "maquina") {
    const nombre = arg || os.hostname();
    const t = leer(`${c.reportes}/${MAQUINAS}/${nombre}.md`);
    console.log(`Fuente: ${fuente}\n`);
    console.log(t ? t.trimEnd() : `No hay inventario de la máquina «${nombre}».`);
  } else {
    console.log("uso: node proyecto.cjs lista | ficha <repo> | reportes <repo> [n] | maquina [nombre]");
    process.exit(2);
  }
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
