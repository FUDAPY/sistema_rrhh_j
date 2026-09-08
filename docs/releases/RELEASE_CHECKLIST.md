# Checklist de Release

## Antes de liberar

- Confirmar version nueva en `VERSION`
- Confirmar que el cambio no rompe login
- Confirmar que el sidebar y navegacion principal siguen estables
- Revisar `Liquidar Pendientes`
- Revisar `Pago Individual`
- Revisar `Lista de Personal`
- Revisar tickets impresos si el cambio toca pagos o vales
- Revisar textos visibles si hubo cambios de UI
- Revisar Firestore para documentos nuevos o campos nuevos

## Si hubo cambios de salarios

- Verificar salario historico
- Verificar salario vigente del mes actual
- Verificar historial salarial

## Si hubo cambios de movimientos

- Verificar editar movimiento
- Verificar eliminar movimiento
- Verificar recalcule de saldo

## Cierre

- Completar notas de release
- Publicar release/tag
- Desplegar
