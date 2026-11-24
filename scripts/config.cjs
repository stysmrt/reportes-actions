// La configuración de esta máquina, ~/.reportes-actions.json (la escribe instalar.cjs):
//   raices      carpetas donde buscar repos
//   vault      la ruta local del vault, si esta máquina lo tiene (opcional)
//   brain       el repositorio del vault (stysmrt/brain-raw)
//   reportes    la carpeta de reportes en el vault (500-proyectos/100-reportes)
//   tz          la zona horaria (America/Lima)
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const CONFIG = process.env.REPORTES_ACTIONS_CONFIG || path.join(os.homedir(), ".reportes-actions.json");

const PREDETERMINADA = {
  raices: [],
  vault: null,
  brain: "stysmrt/brain-raw",
  reportes: "500-proyectos/100-reportes",
  tz: "America/Lima",
};

function leeConfig() {
  try {
    return { ...PREDETERMINADA, ...JSON.parse(fs.readFileSync(CONFIG, "utf8")) };
  } catch {
    return null;
  }
}

function guardaConfig(c) {
  // `duenos` ya no se usa: el inventario no crea fichas (las crea el primer reporte).
  const { duenos, ...resto } = c;
  fs.writeFileSync(CONFIG, JSON.stringify(resto, null, 2) + "\n", "utf8");
}

module.exports = { CONFIG, PREDETERMINADA, leeConfig, guardaConfig };
