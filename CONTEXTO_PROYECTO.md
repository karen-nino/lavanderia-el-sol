# Contexto técnico — Lavandería El Sol

> Documento para pegar al inicio de una conversación nueva con Claude. Técnico y directo.
> Última actualización: 2026-08-27.

---

## 1. Resumen del proyecto

Sistema web de gestión para una lavandería (**Lavandería El Sol**): clientes, notas (autoservicio y por encargo), máquinas, inventario (productos + insumos + bolsas), caja, empleados y ventas. Usuarios: administradores y empleados del negocio (uso interno, no cara al cliente final).

**Estado de uso:** la infraestructura ya está desplegada en producción (Netlify + Fly.io + Supabase, desde 2026-06-22), pero el sistema **todavía no está en uso real** en la lavandería. Falta poner en marcha el **control de máquinas por Sonoff**: el código de la Fase 1 ya está integrado y commiteado, pero **nunca se ha probado contra hardware ni contra la cuenta real de eWeLink**. La credencial de desarrollador de eWeLink **ya se solicitó** (cuenta personal de la desarrolladora, 2026-08-27) y está **en espera de aprobación** (1-2 días hábiles). Como aún no hay datos reales, se pueden correr migraciones y renombres de raíz con libertad.

Dos entornos que conviven: **(1) local** — desarrollo contra Postgres local; **(2) nube** — producción. Se desarrolla en local y se promueve a nube con `git push` / `fly deploy`.

---

## 2. Stack y arquitectura actual

### Frontend
- **React 19** + **Vite 7** + **Tailwind CSS 3.4**. JSX puro, **sin TypeScript**.
- **react-router-dom 7** (ruteo SPA).
- Extras: **recharts 3** (gráficas en Ventas/Desempeño), **react-barcode** (folios).
- ESLint 9 (flat config). Gestor de paquetes: **pnpm**.
- **Pruebas: Vitest 4 + Testing Library** (`environment: jsdom`, `setupFiles: src/test/setup.js`), `pnpm test` / `test:watch`. **56 casos en 15 archivos**: helpers puros de `lib/`, la página **Login**, y componentes con lógica (KpiCard, SalesCard, MachineCard, CircularTimer, EmpleadoDeleteModal, EmpleadoEditModal, CashCutCard, SucursalSelector). `api`/`useAuth`/`useNavigate` se mockean con `vi.mock`/`vi.hoisted`.
- Sin librería de estado global (Redux/Zustand): estado local + un `AuthContext`. Cliente HTTP propio en `lib/api.js` (fetch envuelto), no axios.
- **Exportación a PDF y CSV sin dependencias** (`lib/exportUtils.js`): el CSV se descarga como `Blob`; el PDF se genera abriendo una ventana con HTML y disparando `window.print()` (`@media print`). Encima viven `exportCorte.js`, `exportVentas.js` y `exportReporteInventario.js`.

### Backend
- **Node + Express 5**, ESM (`"type": "module"`).
- **PostgreSQL con `pg` (SQL crudo parametrizado), sin ORM** (nada de Prisma/Sequelize). Toda la lógica vive en controllers.
- **JWT** (`jsonwebtoken`) + **bcrypt** para auth. **multer** para subir el logo. **dotenv**, **nodemon** en dev.
- **Seguridad HTTP:** `helmet` (cabeceras) y `express-rate-limit` (limiters de login y de búsqueda) en middleware.
- **Pruebas: Vitest.** Unit sin BD (`pnpm test`) e integración con `supertest` + Postgres desechable (`pnpm test:integration`, `test:all` corre ambas). **~200 casos** de integración en **14 archivos** que cubren **todos los controllers por HTTP** y el job de cierre del día. Para poder montar la app en tests, `app.js` exporta la app y `index.js` solo hace `listen` + jobs. Arnés en `test/` (bootstrap de la BD, seeds, tokens). Las funciones puras de precios/secado/folio viven en `utils/calculosNotas.js`. **Ojo:** 2 casos unit de `calculosNotas.test.js` están **en rojo** (ver §5).
- Jobs in-process con `setInterval` (no cron externo, no colas), más un **listener de Postgres** (`LISTEN/NOTIFY`) para Sonoff.

### Control de máquinas (Sonoff) — Fase 1 integrada
- `services/dispositivos/` es la **capa de driver**: interfaz `encender/apagar/estado` y selección por `DISPOSITIVOS_DRIVER`. `nullDriver` (simulación en memoria, por defecto) y `ewelinkDriver` (nube eWeLink, API v2, sin dependencias: `fetch` + `crypto` nativos, login firmado HMAC-SHA256, token cacheado con re-login y manejo de redirect de región).
- **Enganche central en la BD, no en los controllers**: el trigger `trg_notificar_sync_maquina` (mig. 075) hace `pg_notify('maquina_sync', id)` al cambiar `estado`/`device_id`/`device_canal`, y `jobs/listenerSonoff.js` (conexión dedicada con reconexión) dispara `services/sincronizarSonoff.js`. Como el notify llega al COMMIT, el "después de commit" sale gratis y no hubo que tocar las ~13 funciones que mueven el estado de una máquina.
- `jobs/reconciliarSonoff.js` reafirma el estado cada 3 min (`SONOFF_RECONCILE_MINUTOS`).
- **La simulación nunca se reporta como enlace bueno**: `dispositivos.esSimulacion()` es la fuente única de verdad; con el driver `null` ni `probarSonoff` ni `sincronizarSonoff` marcan `sonoff_estado = 'enlazada'`, y la UI avisa en ámbar en lugar de pintar palomita verde.

### Base de datos
- PostgreSQL. **Local:** variables `DB_*`. **Prod:** Supabase vía **Session pooler (IPv4, 5432)** con SSL, usando `DATABASE_URL`. `db/pool.js` elige según exista `DATABASE_URL` y exporta `dbConfig` (lo usa el listener).
- **Migraciones caseras**: archivos SQL numerados en `db/migrations/`, runner idempotente (`db/migrate.js`) que registra lo aplicado en `schema_migrations`. Bootstrap = `schema.sql` + migraciones en orden. Van por la **090** (84 archivos). La tabla base histórica se llamaba `ordenes` y fue renombrada a `notas` (mig. 009); `schema.sql` conserva el nombre viejo solo como bootstrap.

### Despliegue
- **Frontend → Netlify** (`chic-banoffee-20c2e3.netlify.app`), base `frontend/`. Proxy `/api` y `/uploads` → Fly y fallback SPA en `frontend/public/_redirects` (en ese orden; **no** duplicar el catch-all en `netlify.toml`).
- **Backend → Fly.io** (`lavanderia-el-sol-api`, región `dfw`). Máquina **siempre encendida** (`min_machines_running = 1`) porque el cierre del día y el listener corren in-process. Migraciones corren como `release_command` en cada deploy. Volumen `uploads` para conservar el logo.
- **DB → Supabase**.
- **Secretos pendientes de configurar** (ver §6): `EWELINK_APP_ID`, `EWELINK_APP_SECRET`, `EWELINK_EMAIL`, `EWELINK_PASSWORD`, `EWELINK_COUNTRY_CODE` (def. `+52`), `EWELINK_REGION` (def. `us`) y `DISPOSITIVOS_DRIVER=ewelink`.

### Estructura del repo (resumen)
```
backend/
  index.js                # listen + jobs (app.js registra rutas /api/*)
  controllers/            # 1 por dominio: auth, notas, caja, maquinas, ventas,
                          #   clientes, productos, insumos, etiquetas,
                          #   notificaciones, sucursales, usuarios, ajustes
  routes/                 # 1 por dominio; verifyToken + sucursalActiva
  middleware/             # auth (JWT + sesión única), roles, sucursalActiva, rateLimit
  jobs/                   # cierreDelDia, limpiezaNotificaciones,
                          #   listenerSonoff (LISTEN), reconciliarSonoff
  services/               # sincronizarSonoff + dispositivos/ (index, nullDriver,
                          #   ewelinkDriver + *.test.js)
  utils/                  # calculosNotas (precios/secado/folio, puro), nombres, tz
  test/                   # integración: helpers/seeds + integration/*.test.js
  db/                     # pool, schema.sql, migrations/, migrate.js, seed.js
frontend/src/
  pages/                  # Dashboard, Notas, NuevaNota, DetalleNota, TicketNota,
                          #   Maquinas, MaquinaUso, GestionMaquinas, Salidas,
                          #   Inventario, Caja, Ventas, Clientes, Empleados,
                          #   EmpleadoDesempeno, Ajustes, Login,
                          #   SeleccionarSucursal
  components/             # Layout, AdminRoute, KpiCard, MachineCard, ...
  context/AuthContext.jsx
  lib/                    # api.js, roles.js, telefono.js, texto.js, fecha.js,
                          #   formatoInventario.js, exportUtils/Corte/Ventas/
                          #   ReporteInventario (+ *.test.js)
  test/setup.js           # jest-dom + stub de matchMedia
info/                     # referencias de diseño (Figma export, docx) — no es código
```

### Diferencias vs. lo que uno esperaría del plan inicial
- **Sonoff: ya hay código, pero sin estrenar.** El control por hardware dejó de ser "externo al sistema": la Fase 1 (encender/apagar por nube eWeLink) está implementada y commiteada. Lo que falta es **operativo** (credenciales, secretos en Fly, Device IDs) y **la primera prueba contra hardware real**. Por defecto corre el driver de simulación.
- **Sin sincronización offline / PWA / service worker**: la app es **online-only** (fetch directo). No hay IndexedDB ni cache local. *(verificado por grep)*
- **Sin websockets**: el "tiempo real" del Dashboard es **polling** (cada 15 s con `setInterval`, y al volver a la pestaña). *(verificado por grep)*
- **Sin librerías de PDF/CSV**: la exportación se hace a mano con `Blob` y `window.print()`.
- **Migraciones caseras en vez de herramienta de migración** (por simplicidad y control total del orden).

---

## 3. Estado por módulo

> El plan de fases original no está versionado en el repo; el estado se mapea a los **módulos funcionales** ya implementados.

### Completos
- **Auth y roles** — JWT; jerarquía `admin_main > admin > operador`. `AdminRoute` protege vistas de admin. `admin_main` inicia sesión tecleando prefijo `***` antes del nombre. **Sesión única** por cuenta (mig. 054). Rate-limit en login.
- **Multisucursal** (mig. 038/039) — header `X-Sucursal` + middleware `sucursalActiva`; el admin es **global** (mig. 059) y cambia de sucursal (`SeleccionarSucursal`), al operador se le fuerza la suya. Sucursales con contacto editable y **orden manual** (mig. 077).
- **Clientes** — CRUD, búsqueda sin acentos (`unaccent`), nombre + apellido + teléfono.
- **Notas** — autoservicio y por encargo; folios; estados (`EN_ESPERA → LAVANDO → SECANDO → LISTA → PAGADA/FINALIZADA`, + `CANCELADA`; mig. 049) con historial (mig. 036) y `pagado` (mig. 037); productos e insumos asociados; edición y cancelación **con motivo** (mig. 089); **forma de pago** EFECTIVO/TRANSFERENCIA/TARJETA (mig. 078/090), obligatoria en todo cobro; **teléfono de contacto** por nota (mig. 079); ticket imprimible (`TicketNota`).
- **Modelo por cargas** (mig. 046-048/057) — cada nota se compone de **cargas** (`nota_cargas`) con su lavadora y secadora; en Por Encargo además prenda, tela/tamaño de edredón, tamaño de carga, ajuste y productos. **Es el único modelo:** la denormalización legada se eliminó (mig. 073).
- **Máquinas y Salidas** — catálogo, estados, uso/liberación, tamaño (mediana/jumbo, mig. 055), tiempos por tipo, `MaquinaUso`, `GestionMaquinas` y `Salidas`. **Por Encargo elige TIPO de máquina al crear la nota** (sin reservar equipo); la máquina física se asigna en Salidas (mig. 076).
- **Control Sonoff — Fase 1 (código)** — enlace `device_id`/`device_canal` por máquina (mig. 074), trigger + listener (mig. 075), driver eWeLink real, reconciliador, indicador de 3 estados, **"Probar enlace"**, **prueba física "Encender 5 segundos"**, aviso de modo simulación y bloqueo de `device_id` duplicado. **Sin estrenar contra hardware.**
- **Inventario — Productos** — CRUD; **marca** (catálogo editable, mig. 063→071); líquidos **por tapa/medida** (mig. 064/067); líquidos **granel vs. marca** con venta por botella (mig. 080), **rellenar bidón** y envase "Bidón" (mig. 082); **historial de movimientos de stock** (mig. 081/083); **stock mínimo** por producto (mig. 065) y **umbral del granel** (mig. 084); **archivar/restaurar** en vez de borrar los usados en notas (mig. 066); stock reservado vs. disponible.
- **Inventario — Bolsas** (mig. 086/087) — chica/grande/jumbo, se compran por rollo y se cobran por **pieza** en la nota, con avisos que incluyen el tamaño.
- **Inventario — Insumos** — CRUD con su propia `categoria` (concepto aparte de la marca de producto).
- **Reporte diario de inventario** (solo admin) — `GET /productos/reporte-diario`: qué salió y qué queda al cierre, reconstruido desde `producto_movimientos` en `America/Mexico_City`. Se exporta a PDF/CSV.
- **Costo de empaquetado** (mig. 088) — configurable en Ajustes, incluido por defecto en cada carga Por Encargo y **contado dentro del tope**.
- **Caja** (mig. 033) — apertura, movimientos, corte e historial. Caja **compartida** (una abierta a la vez, índice único parcial). El corte **separa el efectivo de lo cobrado fuera del cajón** (transferencia y tarjeta). **Exportación de cortes a PDF y CSV** (individual y por período).
- **Ventas / reportes** — resumen por periodo, gráficas (recharts), desempeño por empleado, **exportación a PDF y CSV**, y las notas **canceladas** se listan (sin contar en totales) con modal del motivo.
- **Empleados** — alta con `nombre` + `apellido` (mig. 061), marca de **usuario de prueba** (mig. 060), **Desempeño por día** con filtro por rango/mes/año y modales de detalle.
- **Check-in / salida de empleados** (mig. 062/070) — entrada = primer login del día (medianoche local); salida = cierre de sesión manual.
- **Ajustes** — perfil, sucursales, precios/tiempos por tipo de máquina, topes por carga, **costo de empaquetado**, alertas, logo, y **catálogos editables** (telas, tamaños de edredón, marcas y envases). Se reordenan arrastrando (Pointer Events, mig. 069).
- **Notificaciones** (mig. 040/041/058) — alertas descartables con folio y limpieza periódica.
- **Cierre del día** — job que a la hora local configurada libera máquinas, pasa sus notas a `LISTA` y cierra sesiones de empleados.

### En proceso / pendiente de cerrar
- **Sonoff, puesta en marcha** — el código está listo; falta credencial de eWeLink (solicitada, en espera), secretos en Fly, captura de Device IDs y la primera prueba real.

### Pendientes / no iniciados
- **Fase 2 de Sonoff**: control local en la red de la lavandería (sin nube ni cuotas). El driver está aislado justo para que sea reemplazarlo, no rehacer la integración.
- **Pruebas de las páginas de frontend** (ver §5).

---

## 4. Decisiones técnicas relevantes (tomadas durante el desarrollo)

- **Sonoff por nube y no por red local** (Fase 1): el backend vive en Fly.io/Dallas y no alcanza la red de la lavandería, así que se controla vía nube eWeLink. Se descartó por ahora la auto-detección de fin de ciclo: el temporizador actual es la aproximación.
- **Enganche del Sonoff en la BD, no en los controllers**: trigger + `pg_notify` + listener, en vez de llamar a la sincronización desde las ~13 funciones que cambian el estado de una máquina. Requiere que `LISTEN/NOTIFY` funcione sobre el session pooler de Supabase (probado en local; **confirmar en prod al desplegar**; si fallara, el reconciliador cubre).
- **La simulación jamás se reporta como enlace confirmado**: con `DISPOSITIVOS_DRIVER` en `null`, cualquier `device_id` responde `ok`. Marcar `enlazada` en ese caso pintaría de verde una máquina sin hardware detrás, así que `esSimulacion()` corta tanto en `probarSonoff` como en `sincronizarSonoff` y la UI avisa en ámbar.
- **Un `device_id`+canal no puede repetirse entre máquinas**: se valida en el controller (no con constraint, para dar un mensaje útil) y **entre todas las sucursales**, porque el Sonoff es un aparato físico único. Un mismo `device_id` con canal distinto sí es válido (multi-relé).
- **Parámetros de Postgres casteados explícitamente**: el `UPDATE` de `updateMaquina` usaba `$12` como `varchar` en la asignación y como `text` dentro de un `CASE`, y Postgres rechazaba la consulta entera (`inconsistent types deduced`). Guardar cualquier máquina devolvía 500. Ahora `$12::varchar` en todos sus usos.
- **Exportación PDF/CSV sin librerías**: base compartida en `lib/exportUtils.js` (CSV como `Blob`, PDF por ventana + `window.print()`), reutilizada por Cortes, Ventas y Reporte diario. Evita sumar ~500 KB de jsPDF al bundle.
- **Renombres de raíz aprovechando que no hay datos**: `productos.categoria` → **`marca`** (mig. 071) y `notas.modalidad` → **`tipo_servicio`** (mig. 072). Los **valores** no cambian; solo el nombre del campo.
- **Convención de nombres**: columnas y llaves del wire en **snake_case**; variables locales de React en camelCase.
- **Modelo por cargas (`nota_cargas`)**: una nota es un conjunto de cargas y cada carga es autónoma. `createNota` exige `cargas`; máquinas y totales siempre salen de `nota_cargas`.
- **Por Encargo reserva TIPO, no equipo** (mig. 076): al crear la nota se elige el tipo de máquina; la máquina física se asigna en Salidas. Evita apartar equipos que van a estar parados.
- **Secado por tipo de carga** (mig. 051) y **tiempo propio para edredón** (mig. 053): la duración se **sella en `maquinas.ciclo_minutos`** al poner la máquina en uso y los temporizadores la leen de ahí.
- **Topes de precio por carga** (mig. 050/052): limitan `lavadora + secadora + productos + empaquetado`; el **ajuste manual no cuenta** y es **tope duro para todos los roles**, incluido admin. Se valida en backend antes del COMMIT.
- **Estados por fase de máquina** (mig. 049): `LAVANDO` mientras la nota conserve alguna lavadora en uso; `SECANDO` cuando solo le quedan secadoras.
- **`tipo_prenda` separado de `tipo_servicio`** (mig. 030): `tipo_servicio` = AUTOSERVICIO/POR_ENCARGO y `tipo_prenda` = ROPA/EDREDON.
- **Líquidos granel vs. marca** (mig. 080/082): el granel vive en un bidón del que se rellenan botellas; la marca se vende cerrada. Autoservicio compra **botella**, Por Encargo consume **tapas** (mig. 085).
- **Bolsas por pieza** (mig. 086/087): se compran por rollo y se cobran por pieza; la línea de nota lleva unidad `pieza`.
- **Catálogos editables, no enums**: tela, tamaño de edredón, marca y envase viven en tablas editables; la nota/producto guarda el **texto** (no FK) para conservar el valor si el catálogo cambia.
- **Sesión única** (mig. 054) y **admin global** (mig. 059) + **usuario de prueba** (mig. 060).
- **Check-in por primer login** (mig. 062/070): sin fichaje aparte.
- **Folios `SEQ-DDMMYY`**: `generarFolio(id, fecha)` → `0042-090726`.
- **`stock_disponible` nunca se persiste**: siempre `stock_actual - stock_reservado`.
- **Caja compartida por índice único parcial** (`WHERE estado = 'abierta'`): abrir una segunda devuelve 409.
- **"Ventas de la sesión" de caja por `pagado_en`** (mig. 037): un **trigger** llena `pagado_en` cuando `estado_pago` pasa a `PAGADO` y lo limpia al revertir, así que el ingreso se atribuye al día real del cobro (una nota creada ayer y cobrada hoy cuenta en el corte de hoy). Ventas usa la misma columna para medir períodos.
- **Solo el efectivo cuenta para el corte** (mig. 090): `esperado = fondo + ventas EN EFECTIVO + entradas − salidas`. Transferencias y tarjetas se cobran de verdad pero no entran al cajón; contarlas hacía que el corte marcara un faltante inexistente a costa del empleado en turno. Por eso cobrar exige `forma_pago` (400 si falta), tanto en `PATCH /notas/:id/estado-pago` como al cobrar desde la edición, y revertir un pago la limpia. Las notas viejas sin forma se dan por efectivo, que es lo que el corte asumía implícitamente.
- **Cierre del día in-process** (no cron): por eso la máquina de Fly se mantiene siempre encendida.
- **Proxy en `_redirects` y no en `netlify.toml`**: duplicar el catch-all rompía el proxy `/api`.
- **Login de `admin_main` con prefijo `***`**.

---

## 5. Problemas abiertos / pendientes de decidir

- **Sonoff sin probar contra hardware real**: todo el camino de eWeLink (firma HMAC, endpoints, región) está escrito y cubierto por pruebas con `fetch` mockeado, pero **nunca corrió contra la API real**. Es el riesgo técnico vivo más grande del proyecto.
- **Credencial de eWeLink a nombre de la desarrolladora, no del cliente**: la solicitud se hizo con la cuenta personal. Migrarla al cliente después es barato (cambiar `EWELINK_APP_ID`/`SECRET` en Fly; los Device IDs viven en la BD y no se tocan), pero implica repetir la aprobación de 1-2 días.
- **La credencial gratuita vence al año** y **no está documentado si la renovación sigue siendo gratis** (la página de precios de CoolKit dice "gratis por ahora" y no habla de renovación; el contacto para preguntar es `bd@coolkit.cn`). Conviene anotar la fecha de vencimiento en cuanto la aprueben. Si dejara de ser gratis, la lavandería **no se queda parada**: `sincronizarSonoff` nunca lanza, así que un fallo solo marca la máquina "Sin conexión" y se vuelve al manejo manual.
- **La contraseña de eWeLink del cliente queda guardada como secreto en Fly** (lo exige el login de la API v2). Si el cliente la cambia, el control de máquinas se cae hasta actualizar el secreto.
- **2 pruebas unit en rojo** (`utils/calculosNotas.test.js` → `precioProductoEnNota`): las fixtures se escribieron antes de la venta por botella/tapa y no tienen `precio_botella`, así que esperan 15 y 40 donde la función devuelve 0 en AUTOSERVICIO. **Es la prueba la que quedó obsoleta, no el código de producción** — hay que actualizar las fixtures.
- **`TOTAL GENERAL` del reporte de Ventas no es lo cobrado**: se calcula como `total_cargas + total_productos + total_ajustes` (`ventas.controller.js:206`), mientras que los totales por forma de pago suman `precio_total`. En Por Encargo el tope fija el precio de la carga, así que ambos números difieren (visto en local: cobrado 390 vs total general 365). Hay que decidir si el reporte debe mostrar **lo cobrado** o **la suma de conceptos**; hoy muestra lo segundo y subestima el ingreso.
- **Enum legacy `EDREDON` en `tipo_servicio`**: sigue existiendo por compatibilidad; la prenda Edredón va en `tipo_prenda`.
- **Bundle único grande** (~1.16 MB, ~308 KB gzip): Vite avisa del tamaño; sin code-splitting todavía. No es urgente.
- **Pruebas de frontend incompletas**: hay helpers, componentes con lógica y la página **Login** (56 casos). **Faltan las páginas restantes**, la prioritaria es **`NuevaNota`** (formulario complejo de cargas/productos con tarifas y topes); luego `Empleados`, `Ventas`, `Notas`, `Caja`, `Inventario`. El backend sí está cubierto por completo.

---

## 6. Próximo paso inmediato

1. **Esperar la aprobación de eWeLink** (solicitada el 2026-08-27 con la cuenta personal de la desarrolladora; responden en 1-2 días hábiles por correo). Al aprobarla: crear la aplicación y copiar **App ID** y **App Secret** — el Secret suele mostrarse completo una sola vez.
2. **Reunir el resto de credenciales**: correo y contraseña de la cuenta eWeLink **del cliente** (la dueña de los dispositivos) y el **Device ID de cada Sonoff** (app eWeLink → dispositivo → ajustes), anotando a qué máquina corresponde y, si es multi-relé, qué canal.
3. **Configurar Fly y desplegar** (aplica las migraciones pendientes):
   ```bash
   fly secrets set EWELINK_APP_ID='...' EWELINK_APP_SECRET='...' \
     EWELINK_EMAIL='...' EWELINK_PASSWORD='...' \
     EWELINK_COUNTRY_CODE='+52' EWELINK_REGION='us' \
     DISPOSITIVOS_DRIVER='ewelink' -a lavanderia-el-sol-api
   ```
   Mientras `DISPOSITIVOS_DRIVER` no sea `ewelink`, las máquinas con ID se muestran como "Sin conexión": es correcto, no hay enlace real todavía.
4. **Enlazar una sola máquina primero**: capturar su Device ID en Gestión, darle **"Probar enlace"** y luego **"Encender 5 segundos"** con el equipo vacío. Solo cuando eso funcione, capturar el resto. Confirmar de paso que `LISTEN/NOTIFY` funciona sobre el pooler de Supabase.
5. **Entregar el sistema al cliente** para que empiece el uso real.

**Pendiente de pruebas (para retomar):** arreglar las 2 fixtures obsoletas de `calculosNotas.test.js` y cubrir las **páginas del frontend**, empezando por **`NuevaNota`** (patrón ya validado en `Login` y en los modales).

**Trabajo más reciente (2026-08-27):** forma de pago obligatoria en todo cobro, con **tarjeta** como opción nueva (mig. 090), y corte de caja que **ya no cuenta transferencias ni tarjetas como efectivo** — antes cada corte con pagos no-efectivo salía con un faltante inexistente. Antes de eso: mejoras a Gestión de Máquinas para la puesta en marcha del Sonoff — aviso de modo simulación, indicador de enlace por tarjeta y contador de avance, prueba automática al guardar un Device ID nuevo, bloqueo de IDs duplicados y botón de prueba física. En el camino se corrigió un **500 que rompía el guardado de cualquier máquina** (parámetro sin castear, introducido con la integración Sonoff). Antes de eso: reporte diario de inventario y exportación a PDF/CSV en Cortes y Ventas.
