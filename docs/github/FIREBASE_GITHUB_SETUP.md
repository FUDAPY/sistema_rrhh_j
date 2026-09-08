# Activar deploy de Firebase desde GitHub

Este repositorio ya incluye workflows para:

- `preview` automatico por Pull Request
- `deploy live` automatico al hacer push a `main`
- `deploy live` manual desde la pestaña Actions

## Workflows incluidos

- `.github/workflows/firebase-hosting-preview.yml`
- `.github/workflows/firebase-hosting-live.yml`

## Secreto requerido

Debes crear este secret en GitHub:

- `FIREBASE_SERVICE_ACCOUNT_SYS_RRHH_LINGROUP`

## Paso a paso

### 1. Crear service account en Google Cloud / Firebase

Proyecto:

- `sys-rrhh-lingroup`

Roles recomendados para Hosting:

- `Firebase Hosting Admin`
- `Firebase Authentication Admin`
- `API Keys Viewer`

Si en el futuro usas rewrites hacia Cloud Run o Functions, agrega:

- `Cloud Run Viewer`

## 2. Descargar la clave JSON

Desde la service account creada:

- crear key
- elegir formato JSON
- descargar el archivo

## 3. Cargar secret en GitHub

En el repo:

- `Settings`
- `Secrets and variables`
- `Actions`
- `New repository secret`

Nombre:

- `FIREBASE_SERVICE_ACCOUNT_SYS_RRHH_LINGROUP`

Valor:

- pegar el contenido completo del JSON

## 4. Verificar Actions

En GitHub:

- entrar a la pestaña `Actions`
- verificar que los workflows esten habilitados

## 5. Flujo de uso

### Preview

- crear branch
- editar codigo desde GitHub o subir cambios
- abrir Pull Request
- GitHub Actions publicara un preview URL

### Produccion

- merge a `main`
- el workflow `Deploy Firebase Hosting (Live)` desplegara automaticamente

### Manual

- Actions
- `Deploy Firebase Hosting (Live)`
- `Run workflow`

## Recomendacion operativa

- trabajar cambios funcionales en branches
- usar Pull Request para revisar
- mergear solo a `main` cuando el preview este validado

## Archivos clave del deploy

- `.firebaserc`
- `firebase.json`
- `.github/workflows/firebase-hosting-preview.yml`
- `.github/workflows/firebase-hosting-live.yml`

## Nota

La referencia oficial de Firebase para esta integracion indica que la forma mas sencilla es usar `firebase init hosting:github`, que crea el service account, el secret y los workflows automaticamente.

Fuentes oficiales:

- https://firebase.google.com/docs/hosting/github-integration
- https://github.com/FirebaseExtended/action-hosting-deploy/blob/main/docs/service-account.md
