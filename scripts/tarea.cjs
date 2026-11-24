#!/usr/bin/env node
// Lo que corre la tarea programada de cada PC (la crea instalar.cjs):
//   1. trae lo último de reportes-actions (git pull --ff-only), si se puede;
//   2. corre inventario.cjs con la configuración de ~/.reportes-actions.json.
// Lo que pasa queda en ~/.reportes-actions.log (las últimas 300 líneas).
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { leeConfig, CONFIG } = require("./config.cjs");

const LOG = path.join(os.homedir(), ".reportes-actions.log");
const RAIZ = path.resolve(__dirname, "..");

function anota(texto) {
  const linea = texto
    .trim()
    .split(/\r?\n/)
    .map((l) => `${new Date().toISOString()} ${l}`)
    .join("\n");
  let viejo = "";
  try {
    viejo = fs.readFileSync(LOG, "utf8");
  } catch {}
  const todo = `${viejo}${linea}\n`.split("\n").slice(-300).join("\n");
  fs.writeFileSync(LOG, todo, "utf8");
}

function main() {
  const c = leeConfig();
  if (!c || !c.raices || !c.raices.length) {
    anota(`sin configuración en ${CONFIG}: corre instalar.cjs`);
    process.exit(2);
  }
  const pull = spawnSync("git", ["-C", RAIZ, "pull", "--ff-only", "-q"], { encoding: "utf8" });
  if (pull.status !== 0) anota(`git pull de reportes-actions falló (sigo con lo que hay): ${(pull.stderr || "").trim()}`);

  const args = [path.join(__dirname, "inventario.cjs"), ...c.raices];
  if (c.brain) args.push("--brain", c.brain);
  if (c.usuario) args.push("--usuario", c.usuario);
  if (c.reportes) args.push("--reportes", c.reportes);
  if (c.tz) args.push("--tz", c.tz);
  if (c.profundidad) args.push("--profundidad", String(c.profundidad));
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 9 * 60 * 1000 });
  anota(`${r.stdout || ""}${r.stderr || ""}` || `inventario terminó con ${r.status}`);
  process.exit(r.status ?? 1);
}

main();
