# Sistema RRHH — LinGroup (Gestión Humana)

Aplicación web self-hosted de Recursos Humanos: legajos, vales/anticipos, liquidación de sueldos,
descuentos, ausencias, comisiones y desempeño, con control de acceso por roles.

![Version](https://img.shields.io/badge/version-5.7.0-blueviolet)
![License](https://img.shields.io/badge/license-MIT%20%2B%20attribution-2ea44f)
![Estado](https://img.shields.io/badge/estado-funcional-brightgreen)

**Stack** &nbsp;![Node.js](https://img.shields.io/badge/Node.js-22_LTS-339933?logo=nodedotjs&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?logo=mongodb&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-jsonwebtoken-000000?logo=jsonwebtokens&logoColor=white)
![bcrypt](https://img.shields.io/badge/bcryptjs-3-338033)

**Frontend / Build** &nbsp;![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?logo=tailwindcss&logoColor=white)
![PostCSS](https://img.shields.io/badge/PostCSS-8-DD3A0A?logo=postcss&logoColor=white)
![Phosphor Icons](https://img.shields.io/badge/Phosphor_Icons-CDN-3C3C3C)

**Calidad** &nbsp;![Vitest](https://img.shields.io/badge/Vitest-5-6E9F18?logo=vitest&logoColor=white)
![ESLint](https://img.shields.io/badge/ESLint-10-4B32C3?logo=eslint&logoColor=white)
![Prettier](https://img.shields.io/badge/Prettier-3-F7B93E?logo=prettier&logoColor=white)

**Deploy** &nbsp;![Dokploy](https://img.shields.io/badge/Deploy-Dokploy-6C47FF)
![Railpack](https://img.shields.io/badge/Build-Railpack-FF5A1F)
![Docker](https://img.shields.io/badge/Docker-contenedor-2496ED?logo=docker&logoColor=white)

> **Versión actual: `5.7.0`** — fuente única en el archivo `VERSION`, espejada en `package.json`
> (`version`) y mostrada en la app vía `data-system-version` y el modal _Acerca de_.

> © 2026 Giuliano Emanuel Maria Catella Riveros (Otelax Dev). Licencia **MIT**: se permite usar,
> copiar, modificar y distribuir **mencionando al creador**. Ver `LICENSE`.

---

## 1. Contexto y propósito

**Propósito.** Centralizar la operación diaria de RRHH de LinGroup: alta/baja de funcionarios,
solicitud y aprobación de vales con cupo del **40 % del salario**, liquidación mensual de sueldos
(prorrateo por días hábiles, comisiones, vales y descuentos), control de asistencia (tardanzas y
faltas con multa automática), comprobantes de pago por duplicado y cumpleaños.

**Problema que resuelve.** Reemplaza planillas dispersas y cálculos manuales por un flujo auditable:
cada pago, descuento o ausencia queda registrado con autor, fecha y estado; los pagos que genera
RRHH quedan **pendientes de rendición** y los aprueba el ADMIN.

**Rol del sistema.**

- **Backend** (Node + Express): API REST, autenticación JWT, tiempo real por SSE y archivos estáticos.
- **Frontend** (SPA multi-página con Vite): panel (`rrhh.html`), login (`index.html`) y portales
  públicos (`vales.html`, `descuentos.html`).
- **No** es microservicio ni servicio cloud gestionado: un contenedor en Dokploy + MongoDB.

**Usuarios finales.**

| Usuario                | Acceso                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **ADMIN**              | Total, incluida Gestión de Usuarios y Aprobación de Pagos.                                                                             |
| **RRHH**               | Módulos operativos: no edita fichas (solo **dar de baja**), no ve vales/comisiones/usuarios; sus pagos quedan pendientes de rendición. |
| **Empleado (público)** | Sin login: solicita vales desde `vales.html`.                                                                                          |

**Supuestos.** Un tenant (LinGroup), moneda Guaraní (Gs.), zona horaria America/Asuncion.

---

## 2. Stack tecnológico y versiones

| Capa           | Tecnología                             | Versión                            |
| -------------- | -------------------------------------- | ---------------------------------- |
| Runtime        | Node.js                                | ≥ 22.12 (LTS 22 · probado en 24.x) |
| Lenguaje       | JavaScript ES Modules                  | ES2022                             |
| Backend        | Express                                | 5.x                                |
| Base de datos  | MongoDB (driver oficial)               | driver 7.x                         |
| Auth           | jsonwebtoken + bcryptjs                | 9.x / 3.x                          |
| Build frontend | Vite                                   | 8.x                                |
| Estilos        | Tailwind CSS + PostCSS + autoprefixer  | 3.4 / 8.x / 10.x                   |
| Iconos         | Phosphor Icons (CDN)                   | —                                  |
| Tests          | Vitest                                 | 5.x                                |
| Lint / Format  | ESLint (flat) + Prettier               | 10.x / 3.x                         |
| Assets         | sharp (dev)                            | 0.35.x                             |
| Migración      | firebase-admin (dev, solo para migrar) | 14.x                               |
| Deploy         | Dokploy + Railpack                     | —                                  |

> No se usa TypeScript ni ORM: acceso directo al driver de MongoDB.

---

## 3. Arquitectura y estructura de directorios

**Patrón.** Backend en capas simples (rutas → controladores inline → `store`/`auth`/`realtime`) y
frontend con módulos por feature. El frontend **no conoce** MongoDB: habla con la API.

```
.
├── server/                 # Backend Express (API + SSE + estáticos)
│   ├── index.js            # Rutas, guard de permisos, SSE, arranque
│   ├── access.js           # Matriz de permisos por rol
│   ├── auth.js             # JWT + bcrypt + middlewares
│   ├── db.js               # Conexión MongoDB
│   ├── store.js            # CRUD + consultas genéricas
│   ├── realtime.js         # Hub SSE (un canal por colección)
│   └── values.js           # BSON Date <-> { __ts } del cliente
│
├── public/                 # Frontend (raíz de Vite)
│   ├── index.html          # Login
│   ├── rrhh.html           # Panel de gestión (SPA)
│   ├── vales.html          # Portal público: solicitud de vale
│   ├── descuentos.html     # Alta de descuentos (requiere ADMIN/RRHH)
│   ├── css/app.css         # Tailwind + estilos base
│   ├── js/
│   │   ├── system.js       # Core del panel: router, vistas, dashboard, export, menú
│   │   ├── salarios.js     # Motor de liquidación + vistas de pagos
│   │   ├── vales.js        # Vistas de vales (admin) + cupo
│   │   ├── ausencias.js    # Tardanzas/faltas + multa
│   │   ├── comisiones.js   # Registro y reporte de comisiones
│   │   ├── db.js           # Cliente de datos (API tipo Firestore sobre REST+SSE)
│   │   ├── auth.js         # Auth JWT (API tipo Firebase Auth)
│   │   ├── firebase-config.js  # Re-exporta db/auth
│   │   ├── auth-guard.js   # Guard de sesión/rol
│   │   ├── ui.js           # Toasts y modales
│   │   ├── export.js       # Exportación CSV
│   │   ├── vales-cupo.js   # Regla del 40 % (fuente única)
│   │   ├── print-service.js # Ticket 80 mm (2 ejemplares: administracion y funcionario)
│   │   └── login.js        # Login
│   └── static/             # Copiado tal cual al build (manifest, iconos PWA)
│
├── scripts/                # Utilidades (migración, assets, smoke, usuarios)
├── tests/                  # Tests unitarios (Vitest)
├── vite.config.js          # Build multi-página + proxy /api en dev
├── tailwind.config.js      # Tokens de diseño
├── railpack.json           # Start command para Dokploy/Railpack
├── Procfile                # Alternativa de start command
└── .env / .env.production.example
```

**Principio de responsabilidad.**

- **Rutas/controladores** (`server/index.js`): validar entrada, aplicar permisos, delegar y responder.
- **Dominio/reglas**: en el frontend (`vales-cupo.js`, `salarios.js`) y en `server/access.js`.
- **Persistencia**: exclusivamente en `server/store.js` (nunca consultas sueltas en las rutas).
- **Frontend**: las vistas no llaman `fetch` directo; usan `db.js`/`auth.js`.

---

## 4. Reglas de negocio y restricciones (guardrails)

### Seguridad y autenticación

- **JWT** firmado con `JWT_SECRET`, enviado como `Authorization: Bearer <token>`. El SSE lo recibe
  por query `?token=` (EventSource no admite headers).
- **Contraseñas** con **bcrypt** (10 rondas). `passwordHash` **nunca** se serializa al cliente.
- **Roles**: `ADMIN` y `RRHH`. Se resuelve por el documento de `users`; sin rol → acceso denegado.
- **Denegado por defecto** en `server/access.js`.
- **Rol de sesión**: el menú y los módulos se resuelven con el rol firmado en el JWT
  (`auth.currentUser.role`) sin esperar a la colección `users` (que es exclusiva de ADMIN); el panel
  queda operativo al instante y no se abre un SSE que responda `403` en bucle.
- **HTTPS**: `server/index.js` confía en `X-Forwarded-Proto` (`trust proxy`) y responde **301** a las
  peticiones `http://` (`FORCE_HTTPS`, activo por defecto; `/api/health` queda exento para no romper
  el healthcheck). **HSTS** es opt-in (`HSTS_ENABLED=true`) y debe activarse **solo** cuando el
  dominio ya sirva el certificado Let's Encrypt: una vez publicado, el navegador deja de permitir la
  excepción de certificado. El TLS lo **termina Traefik**, así que un certificado mal emitido no se
  corrige desde la app (ver §10).
- **Cabeceras de seguridad**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy: strict-origin-when-cross-origin` y `Permissions-Policy` restrictiva.
- Secretos solo por variables de entorno; `.env` y `*-firebase-adminsdk-*.json` están en `.gitignore`.

### Permisos por rol (resumen)

| Recurso                                 | ADMIN                 | RRHH                                              |
| --------------------------------------- | --------------------- | ------------------------------------------------- |
| Lectura general                         | ✅                    | ✅                                                |
| `employees` escritura                   | ✅                    | Crear y **solo** `status`/`endDate` (dar de baja) |
| `salaries`                              | ✅ (aprobar/eliminar) | Solo **crear** (queda `PENDIENTE_RENDICION`)      |
| `descuentos`, `sucursales`, `ausencias` | ✅                    | ✅                                                |
| `vales`, `comisiones`                   | ✅                    | Solo cambiar `status` (al liquidar)               |
| `users`                                 | ✅                    | ❌ (403)                                          |
| Público (sin login)                     | —                     | `GET employees`, `GET/POST vales`                 |

### Reglas de cálculo (no romper)

1. **Cupo de vales** = 40 % del salario vigente; un vale `Pendiente` o `Rechazado` no afecta salario.
2. **Liquidación** = `(base prorrateada + comisiones) − (vales aprobados/cobrados + descuentos + ya pagado)`.
3. **Prorrateo** por días hábiles al ingresar/egresar a mitad de mes.
4. `salaryHistory` define el salario vigente del período.
5. Ausencias con multa crean su registro en `descuentos`.
6. **Todo pago creado por RRHH** se guarda con `estadoAprobacion: 'PENDIENTE_RENDICION'` y `creadoPorRol: 'RRHH'`.

### Comprobantes de pago (tickets)

`public/js/print-service.js` emite el comprobante en formato **80 mm** con **dos ejemplares en la misma
impresión**: `EJEMPLAR ADMINISTRACION` y `EJEMPLAR FUNCIONARIO` (se controla con `doubleTicket`, que
por defecto es `true`).

Contenido: logo de la empresa, `LIN GROUP`, dirección `Av. Camilo Recalde c/ Av. Capitan Miranda` –
`Microcentro de Ciudad del Este`, fecha y hora del pago, código, sucursal, **nombre del funcionario
que efectuó el pago**, nombre del funcionario, **C.I.**, cargo, concepto, detalle, monto y las **dos
firmas** (quien recibe y quien paga).

- Se imprime al **liquidar salarios**, en el **pago individual** y al registrar/aprobar **vales**.
- El **Historial de Pagos** y la vista de **Aprobación de Pagos** tienen el botón **Reimprimir
  Ticket**, que vuelve a emitir los dos ejemplares con la fecha/hora original del movimiento.
- `employeeDni` y `payerName` se guardan en `salaries`/`vales` para que la reimpresión sea fiel.

### Manejo de errores

- Formato estándar: `{ "error": "mensaje" }` con el código HTTP adecuado
  (`400` validación, `401` sin sesión, `403` sin permiso, `404` inexistente, `409` duplicado, `500` interno).
- El backend loguea el error y responde el mensaje; el frontend muestra **toast** (no `alert`).

### Lo que NO debe hacerse

- ❌ No usar `alert()`, `confirm()` ni `prompt()` → usar `ui.js`.
- ❌ No hardcodear credenciales, tokens ni URLs de la base; usar variables de entorno.
- ❌ No consultar MongoDB fuera de `server/store.js`.
- ❌ No llamar `fetch` directamente en las vistas; usar `db.js`/`auth.js`.
- ❌ No exponer `passwordHash` ni el listado de `users` a roles distintos de ADMIN.
- ❌ No duplicar la regla del 40 % : vive solo en `public/js/vales-cupo.js`.
- ❌ No crear archivos `.md` adicionales: la documentación vive en este README.

---

## 5. Convenciones de código y estilo

- **Módulos**: ES Modules (`import`/`export`), sin `require`.
- **Nomenclatura**: `camelCase` para variables/funciones, `PascalCase` para clases, `UPPER_SNAKE` para
  constantes de módulo (`HISTORY_PAGE`, `RRHH_WRITE`), `kebab-case` para archivos HTML/CSS.
- **Indentación**: 4 espacios; comillas simples salvo en HTML (dobles). Prettier configurado en `.prettierrc.json`.
- **Comentarios**: breves y técnicos; solo donde la lógica no es obvia. No banners decorativos.
- **Funciones puras**: los cálculos (`vales-cupo.js`, `salarios.js`) deben ser testeables sin DOM.
- **Sin dependencias mágicas**: si se agrega una librería, justificarla y documentarla en la sección 2.

---

## 6. Flujo de trabajo y comandos

```powershell
npm install                 # dependencias

npm run server              # backend en http://localhost:3000
npm run dev                 # frontend en http://localhost:5173 (proxy /api -> 3000)
npm start                   # backend en modo produccion
npm run start:prod          # build + backend (usado por Railpack)
npm run build               # genera /dist
npm run preview             # sirve el build

npm run test                # tests unitarios (Vitest)
npm run test:coverage       # tests + cobertura (umbral 80%)
npm run lint                # ESLint (0 errores)
npm run format:check        # verifica el formato (Prettier)
npm run format              # aplica el formato (Prettier)
npm run smoke               # health + login + datos + SSE + RBAC (servidor corriendo)

npm run migrate             # migra Firestore -> MongoDB (una sola vez)
npm run inventory           # inventario de colecciones de Firestore
npm run probe               # verifica conexion a MongoDB
npm run tls:check -- <dominio>  # diagnostico del certificado HTTPS (Traefik/Dokploy)
npm run user:create -- <email> <password> [ADMIN|RRHH] [Nombre]
npm run assets:optimize     # optimiza el logo y genera iconos PWA
```

> **Antes de entregar cambios**: `npm run format:check` + `npm run lint` (0 errores) + `npm run test:coverage` + `npm run build` en verde.

### CI (GitHub Actions)

`.github/workflows/ci.yml` corre en cada push/PR: **Node 22** (`vitest@5` exige ≥ 22.12) →
`npm ci` → `format:check` → `lint` → `test:coverage` → `build`.

### Editor (VS Code)

El repositorio incluye `.vscode/settings.json` (y `.editorconfig`) con Prettier fijado a
`node_modules/prettier/index.mjs`, `formatOnSave` activado y `documentSelectors` acotados a los lenguajes del proyecto.

Si la extensión Prettier falla con `Cannot find module '.../prettier/index.mjs' imported from '.../prettier/index.cjs'`,
el extension host cacheó un módulo fallido, algo habitual cuando se ejecuta `npm install`/`npm ci` con VS Code abierto.
Solución: **Developer: Reload Window** (`Ctrl+Shift+P`). El CLI (`npm run format`) no se ve afectado porque corre fuera de VS Code.

---

## 7. Variables de entorno

Copiar `.env.production.example` a `.env` (o cargarlas en Dokploy → Environment).

| Variable                     | Obligatoria    | Descripción                                                    |
| ---------------------------- | -------------- | -------------------------------------------------------------- |
| `MONGODB_URI`                | ✅             | URI de conexión. En producción usar la **interna**.            |
| `MONGODB_DB`                 | ✅             | Base de datos (por defecto `rrhh`).                            |
| `JWT_SECRET`                 | ✅             | Secreto para firmar sesiones (largo y aleatorio).              |
| `JWT_EXPIRES_IN`             | —              | Duración de la sesión (por defecto `12h`).                     |
| `PORT`                       | —              | Puerto del servidor (por defecto `3000`).                      |
| `FORCE_HTTPS`                | —              | `true` (def.): redirige `http://` → `https://` con 301.        |
| `HSTS_ENABLED`               | —              | `true` publica HSTS. Activar solo con certificado válido.      |
| `HSTS_MAX_AGE`               | —              | Segundos de HSTS (por defecto `15552000` = 180 días).          |
| `RAILPACK_START_CMD`         | Dokploy        | `npm run start:prod` — evita que Railpack sirva como estático. |
| `RAILPACK_NODE_VERSION`      | Dokploy        | `22` (vitest 5 exige Node ≥ 22.12)                             |
| `FIREBASE_SERVICE_ACCOUNT`   | Solo migración | Ruta al JSON del Admin SDK.                                    |
| `MIGRATION_DEFAULT_PASSWORD` | Solo migración | Contraseña temporal para usuarios migrados.                    |

---

## 8. API

Base: `/api`. Autenticación: `Authorization: Bearer <token>`.

### Auth

| Método | Ruta                           | Rol     | Descripción                                           |
| ------ | ------------------------------ | ------- | ----------------------------------------------------- |
| POST   | `/api/auth/login`              | público | Devuelve `{ token, user }`.                           |
| GET    | `/api/auth/me`                 | sesión  | Usuario actual.                                       |
| POST   | `/api/auth/users`              | ADMIN   | Crea usuario (`{ email, password, fullName, role }`). |
| POST   | `/api/auth/users/:id/password` | ADMIN   | Cambia la contraseña.                                 |

### Datos (genérico)

| Método | Ruta                                                                   | Descripción             |
| ------ | ---------------------------------------------------------------------- | ----------------------- |
| GET    | `/api/data/:collection?where=campo:op:valor&orderBy=campo:dir&limit=n` | Lista documentos.       |
| GET    | `/api/data/:collection/:id`                                            | Un documento.           |
| POST   | `/api/data/:collection`                                                | Crea (body `{ data }`). |
| PATCH  | `/api/data/:collection/:id`                                            | Actualiza campos.       |
| DELETE | `/api/data/:collection/:id`                                            | Elimina.                |

Operadores `where`: `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `not-in`, `array-contains`.
Las fechas viajan como `{ "__ts": <epochMillis> }` (o `{ "__serverTimestamp": true }` al escribir).

### Tiempo real y salud

| Método | Ruta                                    | Descripción                                  |
| ------ | --------------------------------------- | -------------------------------------------- |
| GET    | `/api/realtime/:collection?token=<jwt>` | SSE: emite `event: snapshot` con `{ docs }`. |
| GET    | `/api/health`                           | `{ ok: true }`.                              |

### Colecciones

`ausencias`, `comisiones`, `descuentos`, `employees`, `evaluaciones`, `health`, `proveedores`,
`salaries`, `salaryCarryovers`, `salaryHistory`, `sucursales`, `users`, `vales`.

> Los módulos **Proveedores** y **Evaluaciones** se retiraron del panel (entradas de menú, vistas,
> listeners en tiempo real y archivos `proveedores.js`/`desempeno.js`). Sus colecciones y permisos se
> conservan por compatibilidad con los datos ya migrados.

---

## 9. Modelo de datos (MongoDB, base `rrhh`)

| Colección                    | Campos principales                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `employees`                  | `fullName`, `dni`, `position`, `branch`, `salary`, `startDate`, `endDate`, `status` (ACTIVO/INACTIVO), `photo`, `dob`, `phone`, `address` |
| `salaryHistory`              | `employeeId`, `previousSalary`, `newSalary`, `effectiveFrom`, `reason` (+ auditoría)                                                      |
| `vales`                      | `employeeId`, `amount`, `requestedAmount`, `approvedAmount`, `reason`, `status`, `estadoAprobacion`, `valeDateKey`, `paymentCode`         |
| `salaries`                   | `employeeId`, `netPay`, `salaryBase`, `month`, `year`, `date`, `type` (LIQUIDACION/INDIVIDUAL), `paymentCode`, `estadoAprobacion`         |
| `descuentos`                 | `employeeId`, `amount`, `reason`, `date`, `status` (Aplicado), `deleted`                                                                  |
| `ausencias`                  | `employeeId`, `type`, `startDate`, `endDate`, `minutosTarde`, `montoDescuento`                                                            |
| `comisiones`                 | `employeeId`, `amount`, `reason`, `status` (Pendiente/Aprobado/Pagado)                                                                    |
| `evaluaciones`               | `employeeId`, `score`, período                                                                                                            |
| `sucursales`                 | `name`, `entrada`, `salida`                                                                                                               |
| `proveedores`                | `name`, `ruc`, `phone`, `category`, `address`                                                                                             |
| `users`                      | `email`, `role`, `fullName`, `passwordHash` (nunca sale al cliente)                                                                       |
| `health`, `salaryCarryovers` | Soporte                                                                                                                                   |

Los IDs de MongoDB son `string`. **Soft-delete**: `deleted: true` con `deletedAt` / `deletedBy`.
Los estados de un vale: `Pendiente → Aprobado → Cobrado` (o `Rechazado` / `Anulado`).

---

## 10. Despliegue (Dokploy + Railpack)

```
Internet ─HTTPS─> Dokploy (Railpack) ─> Node/Express (:3000) ─> MongoDB (interno)
                                        ├── sirve /dist (SPA)
                                        └── /api/* (REST + SSE)
```

**Aplicación**

1. _Project_ → _Create Application_; Source: repositorio Git (rama `main`).
2. **Build Type**: `Railpack`. **Port**: `3000`.
3. **Environment**: cargar las variables de la sección 7. Usar la **URI interna** de Mongo
   (`mongodb://usuario:pass@<servicio-mongo>:27017/?authSource=admin`).
4. **Domains**: dominio + HTTPS (Let's Encrypt). 5. **Deploy**.

**Base de datos (servicio MongoDB en Dokploy)**

```env
MONGO_INITDB_ROOT_USERNAME=<usuario>
MONGO_INITDB_ROOT_PASSWORD=<password>
MONGO_INITDB_DATABASE=rrhh
```

> `MONGO_INITDB_*` solo se aplica en el primer arranque (volumen vacío).

> ⚠️ **Railpack + Vite**: Railpack detecta un "SPA" cuando el script `build` contiene `vite build` y
> lo sirve con **Caddy**, dejando la API sin servicio. Por eso el arranque está forzado con
> `railpack.json` (`deploy.startCommand`) y, como garantía, `RAILPACK_START_CMD=npm run start:prod`.
> En los logs debe verse `Sistema RRHH API escuchando en http://0.0.0.0:3000`.

**Checklist post-deploy**: `/api/health` → `{ ok: true }`; login OK; todas las vistas del menú cargan;
un alta/cambio se refleja sin recargar (SSE); **HTTPS activo** y `http://` redirigiendo con **301** a
`https://` (verificar que el proxy envíe `X-Forwarded-Proto`).

**Rollback**: Dokploy guarda snapshots por deploy; los datos viven en MongoDB, no en el contenedor.

### Si el navegador dice «No es seguro» y el certificado es `TRAEFIK DEFAULT CERT`

Ese nombre común lo emite **Traefik** cuando no encuentra ni emite un certificado para el host
consultado. El TLS lo termina Traefik, **no la app**: esto no se corrige con cambios de código.
Diagnóstico (DNS + redirección + emisor/CN/SAN/vigencia + HSTS):

```powershell
npm run tls:check -- mi-dominio.com      # opcional: TLS_CHECK_PORT=<puerto>
```

Checklist, en orden:

1. **Dokploy → Application → Domains**: `Host` exacto (sin `https://`, sin puerto, sin `/`), `Path=/`,
   **`Port=3000`**, `HTTPS` activado y **`Certificate Provider = letsencrypt`**. Si el proveedor queda
   en `none`, Traefik sirve su certificado autofirmado por defecto (el caso reportado).
2. **DNS**: el registro `A` del host debe apuntar a la IP del servidor donde corre Traefik.
3. **Firewall**: puertos **80 y 443** abiertos (la validación ACME de Let's Encrypt usa el 80). En
   **AWS EC2** esto es el **Security Group** (inbound `80`/`443` desde `0.0.0.0/0`); es la causa más
   frecuente de que Traefik no consiga el certificado. Si el proveedor tiene firewall propio (Hetzner,
   Oracle, etc.), abrirlo también allí.
4. Abrir el hostname **registrado** (si registraste el apex, no entres por `www`, y viceversa).
5. **Cloudflare** con proxy activo (nube naranja): pasarlo a _DNS only_ para el reto HTTP-01.
6. **Logs de Traefik** en Dokploy: buscar `unable to obtain certificate` o errores ACME.
7. Corregido lo anterior, esperar la emisión (~1 min), recargar y recién entonces poner
   `HSTS_ENABLED=true`.

---

## 11. Migración Firestore → MongoDB (histórico)

Ya ejecutada con `scripts/migrate-firestore-to-mongo.mjs` (idempotente, preserva IDs y convierte
`Timestamp` → `Date`). Se migraron **11 colecciones** (`ausencias`, `comisiones`, `descuentos`,
`employees`, `health`, `salaries`, `salaryCarryovers`, `salaryHistory`, `sucursales`, `vales`) y la
colección `users` se reconstruyó desde Firebase Auth con `passwordHash` (bcrypt) y
`MIGRATION_DEFAULT_PASSWORD` como contraseña temporal (cambiar tras el primer login).

Firebase ya **no** se usa en runtime: se eliminaron sus dependencias, config y workflows.

---

## 12. Licencia

**MIT con atribución obligatoria** (texto completo en `LICENSE`).

- ✅ Se permite **usar, copiar, modificar, fusionar, publicar, distribuir, sublicenciar y vender**
  el software, incluido uso comercial.
- ⚠️ **Obligatorio mencionar al creador** en cualquier uso, copia o distribución:
    > **Giuliano Emanuel Maria Catella Riveros (Otelax Dev)**
    > Debe figurar en la documentación, pantalla de créditos / “Acerca de”, o sección equivalente.
- ⚠️ Debe conservarse el aviso de copyright y esta licencia en las copias o partes sustanciales.
- ❌ El software se entrega **“tal cual”**, sin garantías.

Atribución sugerida:

> Basado en **Sistema RRHH LinGroup** — © 2026 Giuliano Emanuel Maria Catella Riveros (Otelax Dev).
