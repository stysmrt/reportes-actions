---
name: proyectos-barra
description: Responde sobre los proyectos de programación del usuario (sus repositorios de GitHub) con los reportes centralizados en su vault de Obsidian (500-proyectos/100-reportes de brain-raw). Ahí cada proyecto tiene una ficha con su URL, qué archivos leer para el detalle y en qué máquina y ruta está clonado, y un reporte por día con los commits. Úsala siempre que pregunte en qué va un proyecto, qué cambió, qué se hizo hoy o esta semana en sus repos, dónde tiene clonado un repo, o pida información detallada o buscar algo dentro de un proyecto suyo, aunque no diga «reporte» ni «vault». Por ejemplo «¿en qué va digisider?», «¿qué hice ayer en mis proyectos?», «¿dónde tengo el repo de la app móvil?», «busca en el proyecto de la barra cómo se instala». Solo lee.
---

# Proyectos del usuario, desde sus reportes

El usuario centraliza lo esencial de sus repositorios en su vault (`stysmrt/brain-raw`,
carpeta `500-proyectos/100-reportes/`). Lo escriben solos:
- **GitHub Actions** con cada push a `main`: `<repo>/<AAAA-MM-DD>.md` (los commits del
  día, con enlaces) y el bloque «reporte» de la ficha;
- **el inventario de cada PC** (tarea programada): `maquinas/<PC>.md` y la tabla «Dónde
  está clonado» de cada ficha.

La **ficha** `<repo>/<repo>.md` es el punto de entrada: URL, último reporte, «Dónde
mirar más» (los archivos que explican el proyecto) y en qué máquina y ruta está clonado.

## Cómo responder

Los comandos van con la ruta de esta skill: `node <skill>/scripts/proyecto.cjs …`.

1. **Ubica el proyecto.** Si no sabes el nombre exacto, `proyecto.cjs lista` (todos, con
   su último reporte y en qué máquinas están). Luego `proyecto.cjs ficha <repo>`: la
   ficha y, al final, si está clonado **en esta máquina** y en qué ruta.
2. **Para lo reciente** («qué cambió», «qué hice ayer»): `proyecto.cjs reportes <repo> [n]`
   (los últimos n días). Para varios proyectos, `lista` y después `reportes` de cada uno.
3. **Para el detalle**, en este orden:
   - **Clonado aquí** (la ficha dice la ruta y que existe): lee ahí los archivos de
     «Dónde mirar más» y lo que haga falta (`git log`, buscar en el código). El clon
     puede ir por detrás o por delante de GitHub: si importa, compara con
     `git -C <ruta> status -sb` y dilo.
   - **No está aquí:** consúltalo en GitHub sin clonar: `gh api repos/<repo>/contents/<archivo> -H "Accept: application/vnd.github.raw"`, `gh repo view <repo>`, `gh search code --repo <repo> <texto>`.
     Si hace falta mucho del código, clónalo en una carpeta temporal y dilo; nunca
     dentro del vault.
4. **Cita de dónde sale** cada dato: la ficha o el reporte (su ruta en el vault) y el
   archivo del repositorio (ruta local o URL).

## Reglas

- **Solo lee.** Nunca escribas en el vault ni en los reportes, ni hagas commit, push o
  cambios en un repositorio por esta skill. Para una nota, usa la skill `nota-barra`.
- La primera línea de cada salida dice la **fuente**: GitHub (lo más nuevo) o el vault
  local, que puede estar atrasado si no se hizo `git pull`. Si es el local y la pregunta
  es de hoy, avísalo.
- Las máquinas se llaman por su nombre de Windows (`hostname`). «Inventario» es cuándo
  cambió por última vez lo de esa máquina; si es viejo, la ruta puede haber cambiado.
- «?» en *Sin commit*: git no pudo abrir ese repo en esa máquina (carpeta de otro usuario
  de Windows). No es un error de la skill.
- Si un proyecto no tiene ficha, no está en el sistema de reportes: dilo. Si está
  clonado en alguna máquina, sale en `maquinas/<PC>.md` (`proyecto.cjs maquina`). Si el
  usuario quiere sumarlo, se hace con `node sumar-repo.cjs <ruta del clon> --subir`
  desde el clon de reportes-actions.
