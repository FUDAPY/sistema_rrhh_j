# Politica de Releases y Versionado

Este proyecto usara versionado `MAJOR.MINOR.PATCH`.

## Regla de versiones

- `MAJOR`
  - Cambios grandes o incompatibles
  - Reestructuras relevantes del sistema
  - Cambios que obligan a revisar flujos existentes

- `MINOR`
  - Nuevas funciones compatibles
  - Nuevos modales, vistas, auditorias o mejoras funcionales
  - Integraciones nuevas sin romper comportamiento anterior

- `PATCH`
  - Correcciones puntuales
  - Hotfixes
  - Ajustes de textos, UI, validaciones o bugs chicos

## Convencion de tags

- `v5.7.0`
- `v5.7.1`
- `v5.8.0`

## Flujo recomendado

1. Actualizar `VERSION`
2. Crear o completar notas de release
3. Verificar cambios en UI y flujo critico
4. Publicar release en GitHub
5. Desplegar

## Estado inicial recuperado

La base actual del repositorio arranca desde un snapshot recuperado localmente.
El historial Git previo no estaba disponible en esta copia.
