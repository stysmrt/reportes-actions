// El token del vault (BRAIN_RAW_TOKEN) en esta máquina, para sumar-repo.cjs.
// Se guarda cifrado con DPAPI (el cifrado de Windows ligado a tu usuario) en
// ~/.reportes-actions.token: solo tu usuario en este PC puede descifrarlo, y copiado a
// otra máquina no sirve. El token nunca va como argumento de un comando (se vería en
// la lista de procesos) ni se imprime: va siempre por stdin o stdout entre procesos.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ARCHIVO = process.env.REPORTES_ACTIONS_TOKEN_FILE || path.join(os.homedir(), ".reportes-actions.token");
const FORMA = /^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/;

function powershell(script, entrada) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: entrada,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error((r.stderr || "PowerShell falló").trim().split("\n")[0]);
  return (r.stdout || "").trim();
}

function soloWindows() {
  if (process.platform !== "win32") throw new Error("guardar el token cifrado usa DPAPI: solo en Windows (en otro sistema usa la variable BRAIN_RAW_TOKEN)");
}

const esToken = (t) => FORMA.test(t || "");

/** ¿El token puede leer el vault? (la API de GitHub; no se guarda nada) */
async function puedeLeer(token, brain) {
  const r = await fetch(`https://api.github.com/repos/${brain}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "reportes-actions" },
  });
  return r.status;
}

function guardar(token) {
  soloWindows();
  const cifrado = powershell(
    "$t = [Console]::In.ReadToEnd().Trim(); ConvertTo-SecureString $t -AsPlainText -Force | ConvertFrom-SecureString",
    token
  );
  if (!/^[0-9a-f]+$/i.test(cifrado)) throw new Error("DPAPI no devolvió el token cifrado");
  fs.writeFileSync(ARCHIVO, cifrado + "\n", { encoding: "utf8", mode: 0o600 });
  return ARCHIVO;
}

/** El token guardado, descifrado; null si no hay. */
function leerGuardado() {
  if (!fs.existsSync(ARCHIVO)) return null;
  soloWindows();
  const t = powershell(
    "$s = [Console]::In.ReadToEnd().Trim() | ConvertTo-SecureString; " +
      "$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); " +
      "try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }",
    fs.readFileSync(ARCHIVO, "utf8")
  );
  if (!esToken(t)) throw new Error(`${ARCHIVO} no se pudo descifrar (¿es de otro usuario o de otro PC?): guárdalo de nuevo con --guardar-token`);
  return t;
}

function borrar() {
  if (!fs.existsSync(ARCHIVO)) return false;
  fs.rmSync(ARCHIVO);
  return true;
}

function portapapeles(accion) {
  if (process.platform !== "win32") return null;
  const cmd = accion === "leer" ? "Get-Clipboard -Raw" : "Set-Clipboard -Value ' '";
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8" });
  return r.status === 0 ? (r.stdout || "").trim() : null;
}

module.exports = { ARCHIVO, esToken, puedeLeer, guardar, leerGuardado, borrar, portapapeles };
