// reportes-actions: lo que comparten el reporte de cada push (reporte.cjs, en GitHub
// Actions) y el inventario de cada máquina (inventario.cjs, en el PC). Los dos
// escriben en la misma carpeta del vault:
//
//   <carpeta>/<repo>/<repo>.md        la ficha del proyecto
//   <carpeta>/<repo>/<AAAA-MM-DD>.md  el reporte del día (solo reporte.cjs)
//   <carpeta>/maquinas/<PC>.md        los repos de una máquina (solo inventario.cjs)
//
// La ficha tiene dos bloques entre comentarios HTML (la barra y Obsidian no los
// muestran): `reporte` lo escribe solo reporte.cjs y `clones` se calcula siempre de
// las notas de maquinas/, así que da igual quién lo escriba último.

"use strict";
const fs = require("fs");
const path = require("path");

const MAQUINAS = "maquinas";

function ahora(tz) {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date())) {
    p[type] = value;
  }
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    hora: `${p.hour}:${p.minute}`,
    fechaHora: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`,
    sello: `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`,
  };
}

/** El `id` no se repite en lo que hay del vault (docs/formato-notas.md, «Reglas comunes»). */
function idLibre(brainDir, sello) {
  const usados = new Set();
  const recorre = (dir) => {
    let entradas;
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) recorre(p);
      else if (e.name.endsWith(".md")) {
        const m = fs.readFileSync(p, "utf8").match(/^id:\s*"?([^"\n]+)"?\s*$/m);
        if (m) usados.add(m[1].trim());
      }
    }
  };
  recorre(brainDir);
  if (!usados.has(sello)) return sello;
  for (let i = 2; ; i++) if (!usados.has(`${sello}-${i}`)) return `${sello}-${i}`;
}

/** Una propiedad de una línea del frontmatter: la cambia o la añade antes de `tags:`. */
function ponPropiedad(texto, clave, valor) {
  const re = new RegExp(`^${clave}:.*$`, "m");
  const fin = texto.indexOf("\n---", 3);
  const fm = texto.slice(0, fin);
  if (re.test(fm)) return fm.replace(re, `${clave}: ${valor}`) + texto.slice(fin);
  const nuevo = /^tags:/m.test(fm) ? fm.replace(/^tags:/m, `${clave}: ${valor}\ntags:`) : `${fm}\n${clave}: ${valor}`;
  return nuevo + texto.slice(fin);
}

function propiedad(texto, clave) {
  const fin = texto.indexOf("\n---", 3);
  const m = texto.slice(0, fin < 0 ? texto.length : fin).match(new RegExp(`^${clave}:\\s*"?([^"\\n]*)"?\\s*$`, "m"));
  return m ? m[1].trim() : null;
}

const marca = (nombre, lado) => `<!-- ${nombre}:${lado} -->`;

function bloque(nombre, contenido) {
  return `${marca(nombre, "inicio")}\n${contenido.trimEnd()}\n${marca(nombre, "fin")}`;
}

/** Cambia lo que hay entre las marcas; si no están, el bloque va al final. */
function reemplazaBloque(texto, nombre, contenido) {
  const ini = texto.indexOf(marca(nombre, "inicio"));
  const fin = texto.indexOf(marca(nombre, "fin"));
  if (ini < 0 || fin < ini) return `${texto.trimEnd()}\n\n${bloque(nombre, contenido)}\n`;
  return texto.slice(0, ini) + bloque(nombre, contenido) + texto.slice(fin + marca(nombre, "fin").length);
}

/** `owner/nombre` de un remoto de GitHub, o null. Nunca devuelve credenciales. */
function repoDeRemoto(url) {
  if (!url) return null;
  const m =
    url.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i) ||
    url.match(/^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Un remoto que no es de GitHub, sin usuario ni contraseña. */
function remotoSinCredenciales(url) {
  if (!url) return null;
  return url.replace(/^([a-z+]+:\/\/)[^@/]+@/i, "$1");
}

const rutaFicha = (carpeta, nombre) => path.posix.join(carpeta, nombre, `${nombre}.md`);
const enlaceNota = (rel, texto) => `[[${rel.replace(/\.md$/, "")}|${texto}]]`;

// ---- Notas de máquina ----------------------------------------------------------

const CABECERA_MAQUINA = "| Repositorio | Ruta | Rama | Último commit | Sin commit |";

function celdaRepo(f) {
  if (f.repo) return `[${f.repo}](https://github.com/${f.repo})`;
  return f.remoto ? `\`${f.remoto}\`` : "—";
}

function notaMaquina({ maquina, actualizado, raices, filas, fecha, id }) {
  const fm = [
    "---",
    `maquina: ${maquina}`,
    `actualizado: ${actualizado}`,
    `repos: ${filas.length}`,
    "tags:",
    "  - reporte",
    "  - maquina",
    `created: ${fecha}`,
    `id: "${id}"`,
    "creado_por: Inventario de repos",
    "---",
  ];
  const cuerpo = [
    `# ${maquina}`,
    "",
    "Los repositorios git de esta máquina. Lo escribe `inventario.cjs` de [reportes-actions](https://github.com/stysmrt/reportes-actions); no se edita a mano.",
    "",
    `Carpetas revisadas: ${raices.map((r) => `\`${r}\``).join(", ")}`,
    "",
    "«?» en *Sin commit*: git no pudo abrir el repo, por ejemplo porque la carpeta es de otro usuario de Windows (`git config --global --add safe.directory <ruta>` lo permite). El remoto y la rama se leen igual de `.git`.",
    "",
    CABECERA_MAQUINA,
    "|---|---|---|---|---|",
    ...filas.map((f) => `| ${celdaRepo(f)} | \`${f.ruta}\` | ${f.rama || "—"} | ${f.commit || "—"} | ${f.sinCommit} |`),
  ];
  return `${fm.join("\n")}\n${cuerpo.join("\n")}\n`;
}

/** Lo que dicen todas las notas de maquinas/: [{ maquina, actualizado, filas }]. */
function leeMaquinas(brainDir, carpeta) {
  const dir = path.join(brainDir, ...carpeta.split("/"), MAQUINAS);
  if (!fs.existsSync(dir)) return [];
  const fila = /^\| \[([^\]]+)\]\(https:\/\/github\.com\/[^)]+\) \| `([^`]+)` \| ([^|]*) \| ([^|]*) \| ([^|]*) \|\s*$/;
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".md"))
    .sort()
    .map((n) => {
      const texto = fs.readFileSync(path.join(dir, n), "utf8");
      const filas = [];
      for (const l of texto.split(/\r?\n/)) {
        const m = l.match(fila);
        if (m) filas.push({ repo: m[1], ruta: m[2], rama: m[3].trim(), commit: m[4].trim(), sinCommit: m[5].trim() });
      }
      return {
        maquina: propiedad(texto, "maquina") || n.replace(/\.md$/, ""),
        nota: path.posix.join(carpeta, MAQUINAS, n),
        actualizado: propiedad(texto, "actualizado") || "",
        filas,
      };
    });
}

/** La tabla «Dónde está clonado» de un repo, a partir de las notas de máquina. */
function contenidoClones(maquinas, repo) {
  const filas = [];
  for (const m of maquinas) {
    for (const f of m.filas) {
      if (f.repo.toLowerCase() !== repo.toLowerCase()) continue;
      // Sin alias: el `|` de [[ruta|texto]] partiría la celda de la tabla.
      filas.push(
        `| [[${m.maquina}]] | \`${f.ruta}\` | ${f.rama} | ${f.commit} | ${f.sinCommit} | ${m.actualizado.replace("T", " ")} |`
      );
    }
  }
  if (!filas.length) return "Ninguna máquina lo tiene en su inventario todavía.";
  return ["| Máquina | Ruta | Rama | Último commit | Sin commit | Inventario |", "|---|---|---|---|---|---|", ...filas].join("\n");
}

// ---- Ficha del proyecto --------------------------------------------------------

function fichaNueva({ repo, nombre, fecha, id, creadoPor, reporte, clones }) {
  const fm = [
    "---",
    `repo: ${repo}`,
    `url: https://github.com/${repo}`,
    "tags:",
    "  - reporte",
    "  - proyecto",
    `created: ${fecha}`,
    `id: "${id}"`,
    `creado_por: ${creadoPor}`,
    "---",
  ];
  const cuerpo = [
    `# ${nombre}`,
    "",
    "Ficha del proyecto: dónde está su código, qué leer para el detalle y en qué máquinas está clonado. Los reportes de cada día están en esta misma carpeta.",
    "",
    bloque("reporte", reporte),
    "",
    "## Dónde está clonado",
    "",
    bloque("clones", clones),
  ];
  return `${fm.join("\n")}\n${cuerpo.join("\n")}\n`;
}

const reporteSinReportes = (repo) =>
  `- Repositorio: https://github.com/${repo}\n- Sin reportes todavía: este repositorio aún no tiene el workflow de reportes.`;

/** Las fichas que ya hay: { repo (minúsculas) → { rel, repo } }. */
function fichas(brainDir, carpeta) {
  const dir = path.join(brainDir, ...carpeta.split("/"));
  const res = new Map();
  if (!fs.existsSync(dir)) return res;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === MAQUINAS) continue;
    const rel = rutaFicha(carpeta, e.name);
    const abs = path.join(brainDir, ...rel.split("/"));
    if (!fs.existsSync(abs)) continue;
    const repo = propiedad(fs.readFileSync(abs, "utf8"), "repo");
    if (repo) res.set(repo.toLowerCase(), { rel, repo });
  }
  return res;
}

/** Vuelve a calcular «Dónde está clonado» en todas las fichas. Devuelve las que cambió. */
function actualizaClones(brainDir, carpeta) {
  const maquinas = leeMaquinas(brainDir, carpeta);
  const cambiadas = [];
  for (const { rel, repo } of fichas(brainDir, carpeta).values()) {
    const abs = path.join(brainDir, ...rel.split("/"));
    const antes = fs.readFileSync(abs, "utf8");
    const despues = reemplazaBloque(antes, "clones", contenidoClones(maquinas, repo));
    if (despues !== antes) {
      fs.writeFileSync(abs, despues, "utf8");
      cambiadas.push(rel);
    }
  }
  return cambiadas;
}

module.exports = {
  MAQUINAS,
  ahora,
  idLibre,
  ponPropiedad,
  propiedad,
  bloque,
  reemplazaBloque,
  repoDeRemoto,
  remotoSinCredenciales,
  rutaFicha,
  enlaceNota,
  notaMaquina,
  leeMaquinas,
  contenidoClones,
  fichaNueva,
  reporteSinReportes,
  fichas,
  actualizaClones,
};
