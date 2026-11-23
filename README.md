# reportes-actions

Lo esencial de todos mis repositorios, centralizado como notas en mi vault de Obsidian
(`stysmrt/brain-raw`, carpeta `500-proyectos/100-reportes/`). Desde ahí, yo o una IA
vamos al repositorio que haga falta para el detalle.

```
push a main de cualquier repo ──► workflow reutilizable de este repo ──► <repo>/<fecha>.md
                                                                       └► <repo>/<repo>.md (ficha)
tarea programada de cada PC   ──► scripts/inventario.cjs           ──► maquinas/<PC>.md
                                                                       └► «Dónde está clonado» en las fichas
IA (skill proyectos-barra)    ──► lee fichas y reportes ──► el repo clonado en esa máquina o GitHub
```

Este repositorio es **público** para que lo puedan llamar repos de cualquier dueño
(un workflow de un repo privado solo lo usan repos del mismo dueño). Solo tiene código:
ni notas, ni secretos, ni tokens.

## Qué escribe en el vault

| Nota | La escribe | Qué tiene |
|---|---|---|
| `<repo>/<repo>.md` | el workflow y el inventario, cada uno su bloque | Ficha: URL, último reporte, «Dónde mirar más», en qué máquina y ruta está clonado |
| `<repo>/<AAAA-MM-DD>.md` | el workflow | Una sección por push del día: commits con enlace, archivos, comparar |
| `maquinas/<PC>.md` | el inventario | Los repos git de ese PC: repo, ruta, rama, último commit, archivos sin commit |

Las notas siguen el formato de la barra lateral (`tags`, `created`, `id` único,
`creado_por`). Los bloques de la ficha van entre comentarios HTML
(`<!-- reporte:inicio -->`, `<!-- clones:inicio -->`) que Obsidian no muestra. Si un
push al vault se rechaza porque otro subió a la vez, el script descarta lo suyo y lo
vuelve a escribir encima de lo último.

## Sumar un repositorio

Una vez por repositorio (no por PC), para repos existentes o nuevos, de tu cuenta, de
una organización o de otra cuenta, privados o públicos. Con un comando, desde el clon de
reportes-actions y con el token copiado en el portapapeles (o en la variable
`BRAIN_RAW_TOKEN`):

```
node sumar-repo.cjs <ruta del clon del repo> --subir
```

Crea `.github/workflows/reporte.yml` (con la rama principal del repo) y
`.github/reporte.json` (con README, AGENTS.md, docs… si existen) si faltan. Comprueba
con la API de GitHub que el token puede leer el vault y lo guarda como secreto con
`gh`, sin mostrarlo, y después vacía el portapapeles. Con `--subir` hace commit y push a
la rama principal, y ese push ya es el primer reporte. Si estás en otra rama, súbelo
con tu flujo. `--sin-secreto` y `--cambiar-secreto` controlan el secreto.

A mano es lo mismo:

1. Copia [`ejemplo/reporte.yml`](ejemplo/reporte.yml) a `.github/workflows/reporte.yml`
   (cambia `main` si su rama principal es otra).
2. Opcional: copia [`ejemplo/reporte.json`](ejemplo/reporte.json) a
   `.github/reporte.json` con los archivos que explican el proyecto («Dónde mirar más»).
3. El secreto `BRAIN_RAW_TOKEN` en el repo (Settings → Secrets and variables → Actions)
   o una vez para toda la organización. Es un *fine-grained token* con acceso **solo** a
   `brain-raw` y *Contents: Read and write*, con caducidad. Sin él, el workflow avisa y
   no falla.

El primer push a `main` crea la ficha y el reporte del día.

## Instalar en un PC

```
git clone https://github.com/stysmrt/reportes-actions.git
cd reportes-actions
node instalar.cjs --raiz D:\proyectos --raiz D:\otra\carpeta --duenos stysmrt,sidebarbrain ^
     --vault "D:\Dropbox\brain\raw" --para claude,codex,opencode --ahora
```

- `--raiz`: dónde buscar repos (baja hasta 5 carpetas). `--duenos`: los dueños de
  GitHub cuyos repos tienen ficha aunque aún no tengan el workflow.
- `--vault`: la ruta local del vault, si este PC lo tiene. La skill lo usa solo si no
  puede leer GitHub con `gh`.
- Crea la tarea programada **«Inventario de repos»** (cada día a las 09:00 o `--hora`, y
  5 minutos después de iniciar sesión, sin ventana) que trae lo último de este repo y
  corre el inventario. `--sin-tarea` para no crearla. Lo que hace queda en
  `~/.reportes-actions.log`.
- Instala la skill **`proyectos-barra`** para las IAs de `--para` (claude, codex,
  gemini, opencode, agents).
- La configuración queda en `~/.reportes-actions.json`. El clon no se mueve después:
  la tarea apunta a él.

El inventario trabaja en un clon temporal y parcial del vault (solo la carpeta de
reportes) con las credenciales de git del PC: nunca toca el vault en el que trabajas.
No se salta `safe.directory`: un repo de otro usuario de Windows sale con «?».

## La skill proyectos-barra

Para preguntas como «¿en qué va digisider?», «¿qué hice ayer en mis proyectos?» o
«¿dónde tengo clonada la app móvil?». Lee la ficha y los reportes (de GitHub con `gh`, o
del vault local) y va al detalle en el clon de esa máquina o en GitHub. Solo lee.

```
node skills/proyectos-barra/scripts/proyecto.cjs lista | ficha <repo> | reportes <repo> [n] | maquina [PC]
```

## Scripts

| Archivo | Para qué |
|---|---|
| `.github/workflows/reporte.yml` | Workflow reutilizable (`workflow_call`) |
| `scripts/reporte.cjs` | El reporte de un push (corre en Actions) |
| `scripts/inventario.cjs` | El inventario de un PC (`--vault RUTA` para probar sin subir) |
| `scripts/fichas.cjs` | Lo que comparten los dos: fichas, notas de máquina, bloques |
| `scripts/tarea.cjs` | Lo que corre la tarea programada |
| `scripts/config.cjs` | `~/.reportes-actions.json` |
| `instalar.cjs` | Instalación en un PC |
| `sumar-repo.cjs` | Sumar un repositorio (workflow, `reporte.json`, secreto) |

Node 18 o más nuevo, sin dependencias.
