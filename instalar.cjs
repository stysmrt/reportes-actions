#!/usr/bin/env node
// Deja reportes-actions listo en esta máquina:
//   1. guarda la configuración en ~/.reportes-actions.json;
//   2. instala la skill proyectos-barra para las IAs que se indiquen;
//   3. crea la tarea programada de Windows «Inventario de repos» (cada día y al
//      iniciar sesión), que corre scripts/tarea.cjs.
//
// Uso (desde el clon de reportes-actions, que no se mueve después):
//   node instalar.cjs --raiz <carpeta> [--raiz <carpeta>...] --duenos a,b
//        [--vault <ruta local del vault>] [--para claude,codex,opencode]
//        [--hora 09:00] [--sin-tarea] [--ahora]
// Sin --raiz ni --duenos, usa lo que ya hay en la configuración.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { CONFIG, PREDETERMINADA, leeConfig, guardaConfig } = require("./scripts/config.cjs");

const RAIZ = __dirname;
const SKILLS = ["proyectos-barra"];
const TAREA = "Inventario de repos";
const CARPETAS = {
  claude: () => path.join(os.homedir(), ".claude", "skills"),
  codex: () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "skills"),
  gemini: () => path.join(os.homedir(), ".gemini", "skills"),
  opencode: () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode", "skills"),
  agents: () => path.join(os.homedir(), ".agents", "skills"),
};

function argumentos(argv) {
  const o = { raices: [], duenos: null, vault: undefined, para: [], hora: "09:00", tarea: true, ahora: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      if (i + 1 >= argv.length) throw new Error(`falta el valor de ${a}`);
      return argv[++i];
    };
    if (a === "--raiz") o.raices.push(path.resolve(v()));
    else if (a === "--duenos") o.duenos = v().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--vault") o.vault = path.resolve(v());
    else if (a === "--para") o.para.push(...v().split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--hora") o.hora = v();
    else if (a === "--sin-tarea") o.tarea = false;
    else if (a === "--ahora") o.ahora = true;
    else throw new Error(`no entiendo «${a}»`);
  }
  for (const p of o.para) if (!CARPETAS[p]) throw new Error(`--para «${p}»: ${Object.keys(CARPETAS).join(", ")}`);
  if (!o.para.length) o.para = ["claude"];
  if (!/^\d{2}:\d{2}$/.test(o.hora)) throw new Error(`--hora «${o.hora}»: HH:MM`);
  return o;
}

function configura(o) {
  const c = leeConfig() || { ...PREDETERMINADA };
  if (o.raices.length) c.raices = o.raices;
  if (o.duenos) c.duenos = o.duenos;
  if (o.vault !== undefined) c.vault = o.vault;
  for (const r of c.raices) if (!fs.existsSync(r)) throw new Error(`la carpeta no existe: ${r}`);
  if (c.vault && !fs.existsSync(c.vault)) throw new Error(`el vault no existe: ${c.vault}`);
  if (!c.raices.length) throw new Error("falta --raiz: dónde buscar repos");
  guardaConfig(c);
  return c;
}

/** Copia la skill; solo sustituye una carpeta que ya sea esa misma skill. */
function instalaSkill(skill, carpeta) {
  const origen = path.join(RAIZ, "skills", skill);
  const destino = path.join(carpeta, skill);
  if (fs.existsSync(destino)) {
    const md = path.join(destino, "SKILL.md");
    const nombre = fs.existsSync(md) && (fs.readFileSync(md, "utf8").match(/^name:\s*(.+)$/m) || [])[1];
    if ((nombre || "").trim() !== skill) throw new Error(`${destino} existe y no es la skill ${skill}: no lo toco`);
    fs.rmSync(destino, { recursive: true, force: true });
  }
  fs.mkdirSync(carpeta, { recursive: true });
  fs.cpSync(origen, destino, { recursive: true });
  // El script de la skill lee la configuración con config.cjs: va una copia.
  fs.copyFileSync(path.join(RAIZ, "scripts", "config.cjs"), path.join(destino, "scripts", "config.cjs"));
  return destino;
}

const ps = (s) => `'${String(s).replace(/'/g, "''")}'`;

function creaTarea(hora) {
  if (process.platform !== "win32") {
    return `no es Windows: añade a cron algo como «0 9 * * * ${process.execPath} ${path.join(RAIZ, "scripts", "tarea.cjs")}»`;
  }
  // conhost --headless: la tarea corre sin abrir una ventana de consola.
  const args = `--headless ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(RAIZ, "scripts", "tarea.cjs"))}`;
  const script = [
    `$a = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument ${ps(args)} -WorkingDirectory ${ps(RAIZ)}`,
    `$t = @((New-ScheduledTaskTrigger -Daily -At ${ps(hora)}), (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME))`,
    `$t[1].Delay = 'PT5M'`,
    `$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`,
    `Register-ScheduledTask -TaskName ${ps(TAREA)} -Action $a -Trigger $t -Settings $s -Description 'reportes-actions: inventario de repos al vault' -Force | Out-Null`,
  ].join("; ");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "pipe"] });
  return `tarea «${TAREA}»: cada día a las ${hora} y 5 min después de iniciar sesión`;
}

function main() {
  let o;
  try {
    o = argumentos(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  try {
    const c = configura(o);
    console.log(`configuración: ${CONFIG}`);
    console.log(`  raíces: ${c.raices.join(", ")}`);
    console.log(`  dueños con ficha: ${c.duenos.join(", ") || "(ninguno)"}`);
    console.log(`  vault local: ${c.vault || "(no; la skill lee el vault en GitHub)"}`);
    for (const p of o.para) for (const s of SKILLS) console.log(`skill ${s} (${p}): ${instalaSkill(s, CARPETAS[p]())}`);
    if (o.tarea) console.log(creaTarea(o.hora));
    if (o.ahora) {
      console.log("inventario ahora…");
      const r = spawnSync(process.execPath, [path.join(RAIZ, "scripts", "tarea.cjs")], { encoding: "utf8" });
      console.log(r.status === 0 ? "hecho (detalle en ~/.reportes-actions.log)" : `falló (${r.status}); mira ~/.reportes-actions.log`);
    }
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}

main();
