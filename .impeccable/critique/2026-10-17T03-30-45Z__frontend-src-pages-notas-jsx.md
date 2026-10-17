---
target: notas
total_score: 27
p0_count: 0
p1_count: 2
timestamp: 2026-10-17T03-30-45Z
slug: frontend-src-pages-notas-jsx
---
# Critique: Notas (frontend/src/pages/Notas.jsx)

| # | Heurística | Puntos | Problema clave |
|---|---|---|---|
| 1 | Visibilidad del estado | 3 | El filtro activo se ve, pero en dos lugares (chip + botón azul) |
| 2 | Lenguaje del mundo real | 3 | Términos del mostrador; "Pendiente" vs "Por Cobrar" se mezclan |
| 3 | Control y libertad | 3 | La × del chip quita el filtro; elegir estado borra la fecha sin avisar |
| 4 | Consistencia | 2 | Notas filtra con íconos redondos + modales; Caja y Ventas con selector de período |
| 5 | Prevención de errores | 3 | Borrado múltiple con confirmación |
| 6 | Reconocer en vez de recordar | 2 | Embudo y calendario sin texto: hay que recordar cuál es cuál |
| 7 | Flexibilidad | 3 | Búsqueda + filtros + URL; no se combina estado con servicio |
| 8 | Estética minimalista | 3 | Tarjeta limpia; filtros apretados arriba |
| 9 | Recuperación de errores | 3 | Vacío dice qué no hay, pero no ofrece salida |
| 10 | Ayuda | 2 | Sin pistas de qué filtra cada ícono |
| **Total** | | **27/40** | Aceptable |

## Problemas prioritarios
- [P1] Filtros en la cabecera, solo con íconos: mover a un renglón bajo la búsqueda con dos selectores con texto (Fecha / Estado), como Caja y Ventas.
- [P1] Inconsistencia con Caja/Ventas: unificar el patrón del selector (panel con Mes/Año desplegables dentro, sin modales).
- [P2] Estado y servicio en una sola lista (franja border-l-4 de color): separar o quitar la franja.
- [P2] Estado vacío sin salida: botón "Ver todas las fechas".
- [P3] Placeholder de búsqueda cortado en celular; "Hoy" repetido (chip + encabezado del grupo); hueco grande entre búsqueda y lista.

## Detector
- side-tab (línea 21, border-l-4 en filtro de servicio): real.
- border-accent-on-rounded (línea 642, spinner border-b-2): falso positivo.
