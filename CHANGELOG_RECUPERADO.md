# Changelog Recuperado

Este archivo reconstruye los cambios realizados sobre este proyecto a partir del estado actual del workspace y del historial conversacional disponible.

Importante:
- Este proyecto no conserva carpeta `.git`, por lo tanto no existe historial Git recuperable en esta copia.
- Las fechas de abajo reflejan la cronologia disponible en esta sesion.
- El detalle se limita a que codigo/archivos fueron modificados, sin inventar commits previos.

## 2026-06-03

- `public/js/firebase-config.js`
  - Ajustes de inicializacion de Firestore.
  - Activacion de `initializeFirestore`.
  - Parametros para `ignoreUndefinedProperties`.
  - Parametros de `experimentalForceLongPolling`.

- `public/rrhh.html`
  - Ajustes de identificadores visuales para estado del sistema.

- `public/js/login.js`
  - Limpieza de textos y codificacion visible.

- `public/index.html`
  - Limpieza de textos y codificacion visible.

- `public/js/system.js`
  - Limpieza de textos visibles y mensajes de consola con caracteres corruptos.

- `public/vales.html`
  - Regrabado completo del archivo para eliminar textos corruptos.
  - Conservacion de la logica publica de solicitud de vales.

- `public/js/salarios.js`
  - Limpieza de comentarios y textos internos con codificacion rota.

## 2026-06-11

- `public/js/salarios.js`
  - Mejora del modal `Detalle de Liquidacion`.
  - Modal centrado, responsive y con scroll interno.
  - Bloqueo y restauracion del scroll del `body`.
  - Acciones de editar y eliminar movimientos en historial.
  - Soft delete para movimientos con campos de auditoria.
  - Recalculo visual del saldo luego de editar o eliminar movimientos.
  - Soporte para historial salarial por periodo.
  - Calculo de salario vigente segun mes liquidado.

- `public/js/system.js`
  - Integracion del listener de `salaryHistory`.
  - Nueva accion `Aumentar salario` en `Lista de Personal`.
  - Modal de aumento salarial.
  - Registro de historial salarial con auditoria minima.
  - Visualizacion de salario vigente e indicadores de aumentos en fichas de personal.

## 2026-06-12

- `CHANGELOG_RECUPERADO.md`
  - Creacion del archivo de recuperacion de historial tecnico para inicializar repositorio privado nuevo.

- `README.md`
  - Ampliacion con estructura del proyecto y referencia a deploy desde GitHub.

- `.gitignore`
  - Base minima para limpieza del repositorio.

- `VERSION`
  - Archivo central de version actual.

- `RELEASES.md`
  - Politica de releases y versionado.

- `docs/releases/README.md`
  - Indice de documentacion de releases.

- `docs/releases/RELEASE_CHECKLIST.md`
  - Checklist operativo de release.

- `docs/releases/RELEASE_NOTES_TEMPLATE.md`
  - Plantilla de notas de release.

- `docs/releases/VERSIONING_EXAMPLES.md`
  - Guia de ejemplos de versionado.

- `.github/workflows/firebase-hosting-live.yml`
  - Workflow para deploy live desde GitHub Actions.

- `.github/workflows/firebase-hosting-preview.yml`
  - Workflow para preview por Pull Request.

- `.github/PULL_REQUEST_TEMPLATE.md`
  - Plantilla de Pull Request.

- `docs/github/FIREBASE_GITHUB_SETUP.md`
  - Guia para activar deploy de Firebase desde GitHub.
