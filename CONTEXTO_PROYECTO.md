# Contexto técnico — Lavandería El Sol

> Documento para pegar al inicio de una conversación nueva con Claude. Técnico y directo.
> Última actualización: 2026-09-02.

---

## 1. Resumen del proyecto

Sistema web de gestión para una lavandería (**Lavandería El Sol**): clientes, notas (autoservicio y por encargo), máquinas, inventario (productos + insumos + bolsas), caja, empleados y ventas. Usuarios: administradores y empleados del negocio (uso interno, no cara al cliente final).

**Estado de uso:** la infraestructura está desplegada en producción (Netlify + Fly.io + Supabase, desde 2026-06-22) y el sistema **todavía no está en uso real** en la lavandería. El **control de máquinas por Sonoff ya está activo en producción** (desde el release **v25**, 2026-08-28; el backend corre hoy en la **v27**): credencial de eWeLink aprobada, aplicación creada, los 7 secretos cargados en Fly y el driver real corriendo. Lo único que falta para estrenarlo es **capturar el Device ID de cada Sonoff** y hacer la **primera prueba contra hardware físico** — el camino completo de la API de eWeLink sigue sin ejercitarse contra la nube real. Como aún no hay datos reales, se pueden correr migraciones y renombres de raíz con libertad.

Dos entornos que conviven: **(1) local** — desarrollo contra Postgres local; **(2) nube** — producción. Se desarrolla en local y se promueve a nube con `git push` / `fly deploy`.

Dentro de la app hay además un **entorno de pruebas aislado**: la sucursal oculta `pruebas` (mig. 095), donde operan los dos usuarios `es_prueba`. Sus notas, caja e inventario no se mezclan con los datos reales y no pueden tocar la configuración global. Está **activo en local y en producción** desde el 2026-09-02.

---

## 2. Stack y arquitectura actual

### Frontend
- **React 19** + **Vite 7** + **Tailwind CSS 3.4**. JSX puro, **sin TypeScript**.
- **react-router-dom 7** (ruteo SPA).
- Extras: **recharts 3** (gráficas en Ventas/Desempeño), **react-barcode** (folios), **html-to-image** (convierte el recibo en PNG para mandarlo por WhatsApp).
- ESLint 9 (flat config). Gestor de paquetes: **pnpm**.
- **Pruebas: Vitest 4 + Testing Library** (`environment: jsdom`, `setupFiles: src/test/setup.js`), `pnpm test` / `test:watch`. **56 casos en 15 archivos, todos en verde**: helpers puros de `lib/`, la página **Login**, y componentes con lógica (KpiCard, SalesCard, MachineCard, CircularTimer, EmpleadoDeleteModal, EmpleadoEditModal, CashCutCard, SucursalSelector). `api`/`useAuth`/`useNavigate` se mockean con `vi.mock`/`vi.hoisted`.
- Sin librería de estado global (Redux/Zustand): estado local + un `AuthContext`. Cliente HTTP propio en `lib/api.js` (fetch envuelto), no axios.
- **El ticket se manda como imagen, no como texto** (`TicketNota.jsx`): `html-to-image` rasteriza el nodo del recibo (`pixelRatio: 2`, `skipFonts: true`) y el PNG se entrega por **Web Share API** (`navigator.share` con `files`) en celular; en escritorio, donde no hay hoja de compartir, se descarga el PNG y se abre `wa.me` con el ticket en texto.
- **Exportación a PDF y CSV sin dependencias** (`lib/exportUtils.js`): el CSV se descarga como `Blob`; el PDF se genera abriendo una ventana con HTML y disparando `window.print()` (`@media print`). Encima viven `exportCorte.js`, `exportVentas.js` y `exportReporteInventario.js`.

### Backend
- **Node + Express 5**, ESM (`"type": "module"`).
- **PostgreSQL con `pg` (SQL crudo parametrizado), sin ORM** (nada de Prisma/Sequelize). Toda la lógica vive en controllers.
- **JWT** (`jsonwebtoken`) + **bcrypt** para auth. **multer** para subir el logo. **dotenv**, **nodemon** en dev.
- **Seguridad HTTP:** `helmet` (cabeceras) y `express-rate-limit` (limiters de login y de búsqueda) en middleware.
- **Pruebas: Vitest.** Unit sin BD (`pnpm test`) e integración con `supertest` + Postgres desechable (`pnpm test:integration`, `test:all` corre ambas). **203 casos** de integración en **15 archivos** que cubren **todos los controllers por HTTP** y el job de cierre del día. Para poder montar la app en tests, `app.js` exporta la app y `index.js` solo hace `listen` + jobs. Arnés en `test/` (bootstrap de la BD, seeds, tokens). Las funciones puras de precios/secado/folio viven en `utils/calculosNotas.js`. **Todo en verde** (23 unit + 203 de integración, verificado el 2026-09-02).
- Jobs in-process con `setInterval` (no cron externo, no colas), más un **listener de Postgres** (`LISTEN/NOTIFY`) para Sonoff.

### Control de máquinas (Sonoff) — Fase 1 ACTIVA en producción
- `services/dispositivos/` es la **capa de driver**: interfaz `encender/apagar/estado` y selección por `DISPOSITIVOS_DRIVER`. `nullDriver` (simulación en memoria, por defecto en local) y `ewelinkDriver` (nube eWeLink, API v2, sin dependencias: `fetch` + `crypto` nativos, login firmado HMAC-SHA256, token cacheado con re-login y manejo de redirect de región). **En producción corre `ewelink`; en local sigue el `null`.**
- **Enganche central en la BD, no en los controllers**: el trigger `trg_notificar_sync_maquina` (mig. 075) hace `pg_notify('maquina_sync', id)` al cambiar `estado`/`device_id`/`device_canal`, y `jobs/listenerSonoff.js` (conexión dedicada con reconexión) dispara `services/sincronizarSonoff.js`. Como el notify llega al COMMIT, el "después de commit" sale gratis y no hubo que tocar las ~13 funciones que mueven el estado de una máquina.
- `jobs/reconciliarSonoff.js` reafirma el estado cada 3 min (`SONOFF_RECONCILE_MINUTOS`).
- **La simulación nunca se reporta como enlace bueno**: `dispositivos.esSimulacion()` es la fuente única de verdad; con el driver `null` ni `probarSonoff` ni `sincronizarSonoff` marcan `sonoff_estado = 'enlazada'`, y la UI avisa en ámbar en lugar de pintar palomita verde.
- **Aplicación de eWeLink**: tipo `OAuth2.0`, rol `Standard Role`, Redirect URL `https://lavanderia-el-sol-api.fly.dev/api/ewelink/callback`. **Esa URL no se usa ni existe como ruta**: el driver entra con correo + contraseña firmados, pero el formulario de alta exige el campo.

### Base de datos
- PostgreSQL. **Local:** variables `DB_*`. **Prod:** Supabase vía **Session pooler (IPv4, 5432)** con SSL, usando `DATABASE_URL`. `db/pool.js` elige según exista `DATABASE_URL` y exporta `dbConfig` (lo usa el listener).
- **Migraciones caseras**: archivos SQL numerados en `db/migrations/`, runner idempotente (`db/migrate.js`) que registra lo aplicado en `schema_migrations`. Bootstrap = `schema.sql` + migraciones en orden. Van por la **095** (89 archivos), **todas aplicadas en producción** (las 091-095 entraron con el release **v27**, 2026-09-02; verificado contra Supabase). La tabla base histórica se llamaba `ordenes` y fue renombrada a `notas` (mig. 009); `schema.sql` conserva el nombre viejo solo como bootstrap.

### Despliegue
- **Frontend → Netlify** (`chic-banoffee-20c2e3.netlify.app`), base `frontend/`. Proxy `/api` y `/uploads` → Fly y fallback SPA en `frontend/public/_redirects` (en ese orden; **no** duplicar el catch-all en `netlify.toml`).
- **Backend → Fly.io** (`lavanderia-el-sol-api`, región `dfw`). Máquina **siempre encendida** (`min_machines_running = 1`) porque el cierre del día y el listener corren in-process. Migraciones corren como `release_command` en cada deploy. Volumen `uploads` para conservar el logo.
- **DB → Supabase**.
- **Secretos en Fly (los 9 en estado `Deployed`)**: `DATABASE_URL`, `JWT_SECRET`, `EWELINK_APP_ID`, `EWELINK_APP_SECRET`, `EWELINK_EMAIL`, `EWELINK_PASSWORD`, `EWELINK_COUNTRY_CODE` (`+52`), `EWELINK_REGION` (`us`) y `DISPOSITIVOS_DRIVER=ewelink`.
- **Para cargar secretos sin pelear con el shell**: `pbpaste > ~/archivo.txt` y luego `fly secrets import --stage -a lavanderia-el-sol-api < ~/archivo.txt && rm ~/archivo.txt`. Evita el Ctrl-D (que en el prompt de zsh cierra la pestaña) y las comillas. **No** copiar el bloque de la variante `fly secrets set`: arrastra comillas simples y barras `\` que se guardan como parte del valor.

### Versión de la app
- La app muestra su versión **al pie de la pantalla de login** ("Versión 1.0.0"), para que el cliente y nosotros sepamos qué está corriendo en su tablet sin abrir nada.
- **Fuente única de la verdad: `frontend/package.json` → `"version"`.** `vite.config.js` la lee en tiempo de build y la inyecta como `__APP_VERSION__`; `src/lib/version.js` la expone como `APP_VERSION` (fallback `'dev'`), y `src/pages/Login.jsx` la pinta. **Para subir la versión se toca esa única línea de `package.json`.**
- Como se congela al compilar, el número **solo cambia cuando se vuelve a desplegar el frontend en Netlify**.
- **No confundir con el "release vNN" de Fly.io** (v25, v26, …): ese lo numera Fly solo, por cada deploy del backend, y no tiene relación con la versión que ve el cliente.
- **Arrancamos en `1.0.0` = la versión que se le entrega al cliente.** De aquí en adelante el número se sube en cada entrega, con criterio semver simple: **parche** (1.0.1) para correcciones, **menor** (1.1.0) cuando se agrega funcionalidad, **mayor** (2.0.0) para un cambio grande de cómo se usa el sistema. Mientras la app no esté entregada, el número se queda en 1.0.0.

### Nombres de producto, unidades y orden (compartido)
- `frontend/src/lib/formatoInventario.js` concentra cómo se nombra y ordena un producto en **todas** las listas: `etiquetaProducto` (una línea: "Ensueño · Suavizante"), `tituloProducto`/`subtituloProducto` (dos líneas: marca arriba, nombre o "Granel" abajo) y `ordenProducto` (**granel → marca → bolsas**, el mismo criterio con que el backend ordena el catálogo).
- Existe porque dos productos pueden llamarse igual (el Suavizante a granel y el "Ensueño · Suavizante"): sin la marca o el "Granel" se ven idénticos en la nota, en Salidas y en el ticket.
- **La unidad y el precio dependen del servicio** (`utils/calculosNotas.js`): Autoservicio vende la **botella** entera (`precio_botella`) y Por Encargo cobra por **tapa** (`precio_unitario`). Las pantallas que ofrecen productos tienen que convertir el stock (que vive en tapas) a esa unidad, o enseñan un número y cobran otro.

### Utilería de desarrollo
- **Skill `/run-lavanderia-el-sol`** (`.claude/skills/run-lavanderia-el-sol/`) — levanta la app y la recorre en un Chrome headless con Playwright, dejando una captura por pantalla; falla si hay errores de consola. Documenta los tropiezos del entorno (el prefijo `***` del login, el `sid` del JWT, `sucursalActiva` en `localStorage`, el salto de Vite al 5174).
- `backend/scripts/sesion-driver.mjs` — firma un JWT con el `JWT_SECRET` local para entrar sin contraseña; sirve también para probar la API con `curl`.

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
  db/                     # pool, schema.sql, migrations/, migrate.js, seed.js,
                          #   seed_pruebas.js (entorno de pruebas)
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
- **Sonoff: desplegado y activo, pero sin estrenar contra hardware.** El control por hardware dejó de ser "externo al sistema": la Fase 1 (encender/apagar por nube eWeLink) está implementada, commiteada **y corriendo en producción con credenciales reales**. Lo único que falta es capturar los **Device IDs** y la **primera prueba física**.
- **Sin sincronización offline / PWA / service worker**: la app es **online-only** (fetch directo). No hay IndexedDB ni cache local. *(verificado por grep)*
- **Sin websockets**: el "tiempo real" del Dashboard es **polling** (cada 15 s con `setInterval`, y al volver a la pestaña). *(verificado por grep)*
- **Sin librerías de PDF/CSV**: la exportación se hace a mano con `Blob` y `window.print()`. *(verificado por grep: sin jsPDF, pdfmake, html2canvas ni papaparse)*. La única dependencia de render que entró es **html-to-image**, y solo para el PNG del ticket.
- **Migraciones caseras en vez de herramienta de migración** (por simplicidad y control total del orden).

---

## 3. Estado por módulo

> El plan de fases original no está versionado en el repo; el estado se mapea a los **módulos funcionales** ya implementados.

### Completos
- **Auth y roles** — JWT; jerarquía `admin_main > admin > operador`. `AdminRoute` protege vistas de admin. `admin_main` inicia sesión tecleando prefijo `***` antes del nombre. **Sesión única** por cuenta (mig. 054). Rate-limit en login.
- **Multisucursal** (mig. 038/039) — header `X-Sucursal` + middleware `sucursalActiva`; el admin es **global** (mig. 059) y cambia de sucursal (`SeleccionarSucursal`), al operador se le fuerza la suya. Sucursales con contacto editable y **orden manual** (mig. 077) y, desde la mig. 095, **ocultas** (`sucursales.oculta`).
- **Entorno de pruebas aislado** (mig. 095) — los usuarios `es_prueba` viven en la sucursal oculta `pruebas`: `sucursalActiva` les fuerza esa sucursal ignorando el header (aunque su rol sea admin) y las ocultas no son slugs elegibles para nadie más, ni para el `admin_main`. `bloquearPruebaGlobal` (403) les cierra las escrituras de lo que es del negocio entero: `/ajustes`, `/sucursales`, `/usuarios` y `/etiquetas`. En la UI no ven el selector de sucursal ni la gestión de personal, y Ajustes les muestra solo "Mi Perfil" con un aviso del entorno. `db/seed_pruebas.js` deja la sucursal lista (usuarios + 5 máquinas + 3 productos) y es idempotente.
- **Clientes** — CRUD, búsqueda sin acentos (`unaccent`), nombre + apellido + teléfono.
- **Notas** — autoservicio y por encargo; folios; estados (`EN_ESPERA → LAVANDO → SECANDO → LISTA → PAGADA/FINALIZADA`, + `CANCELADA`; mig. 049) con historial (mig. 036) y `pagado` (mig. 037); productos e insumos asociados; edición y cancelación **con motivo** (mig. 089); **forma de pago** EFECTIVO/TRANSFERENCIA/TARJETA (mig. 078/090), obligatoria en todo cobro; **teléfono de contacto** por nota (mig. 079); ticket (`TicketNota`).
- **Ticket para el cliente** (`TicketNota`) — se manda por WhatsApp **como PNG** del propio recibo. En **Por Encargo** cada carga es **una sola línea** ("1 × Servicio por encargo · Chica") con el **precio que se cobra** (el tope del tamaño + ajuste, no el costo interno) y sin el renglón "Tipo": el cliente no ve máquinas, productos ni empaquetado. Autoservicio y Edredón conservan su desglose completo. En el encabezado sale el **R.F.C.** del negocio y al pie la **nota en letra chica**, ambos capturados en Ajustes y omitidos si están vacíos.
- **Modelo por cargas** (mig. 046-048/057) — cada nota se compone de **cargas** (`nota_cargas`) con su lavadora y secadora; en Por Encargo además prenda, tela/tamaño de edredón, tamaño de carga, ajuste y productos. **Es el único modelo:** la denormalización legada se eliminó (mig. 073).
- **Máquinas y Salidas** — catálogo, estados, uso/liberación, tamaño (mediana/jumbo, mig. 055), tiempos por tipo, `MaquinaUso`, `GestionMaquinas` y `Salidas`. **Por Encargo elige TIPO de máquina al crear la nota** (sin reservar equipo); la máquina física se asigna en Salidas (mig. 076).
- **Control Sonoff — Fase 1 (código + despliegue)** — enlace `device_id`/`device_canal` por máquina (mig. 074), trigger + listener (mig. 075), driver eWeLink real, reconciliador, indicador de 3 estados, **"Probar enlace"**, **prueba física "Encender 5 segundos"**, aviso de modo simulación y bloqueo de `device_id` duplicado. **Corriendo en producción desde 2026-08-28; falta capturar Device IDs y probar con hardware.**
- **Inventario — Productos** — CRUD; **marca** (catálogo editable, mig. 063→071); líquidos **por tapa/medida** (mig. 064/067); líquidos **granel vs. marca** con venta por botella (mig. 080), **rellenar bidón** y envase "Bidón" (mig. 082); **historial de movimientos de stock** (mig. 081/083); **stock mínimo** por producto (mig. 065) y **umbral del granel** (mig. 084); **archivar/restaurar** en vez de borrar los usados en notas (mig. 066); stock reservado vs. disponible.
- **Inventario — Bolsas** (mig. 086/087) — chica/grande/jumbo, se compran por rollo y se cobran por **pieza** en la nota, con avisos que incluyen el tamaño.
- **Inventario — Insumos** — CRUD con su propia `categoria` (concepto aparte de la marca de producto).
- **Reporte diario de inventario** (solo admin) — `GET /productos/reporte-diario`: qué salió y qué queda al cierre, reconstruido desde `producto_movimientos` en `America/Mexico_City`. Se exporta a PDF/CSV.
- **Costo de empaquetado** (mig. 088) — configurable en Ajustes, incluido por defecto en cada carga Por Encargo y **contado dentro del tope**.
- **Caja** (mig. 033) — apertura, movimientos, corte e historial. Caja **compartida** (una abierta a la vez, índice único parcial). El corte **separa el efectivo de lo cobrado fuera del cajón** (transferencia y tarjeta). **Exportación de cortes a PDF y CSV** (individual y por período).
- **Ventas / reportes** — resumen por periodo, gráficas (recharts), desempeño por empleado, **exportación a PDF y CSV**, desglose **por concepto y por forma de cobro** (con la diferencia explicada), y las notas **canceladas** se listan (sin contar en totales) con modal del motivo.
- **Empleados** — alta con `nombre` + `apellido` (mig. 061), marca de **usuario de prueba** (mig. 060), **Desempeño por día** con filtro por rango/mes/año y modales de detalle.
- **Check-in / salida de empleados** (mig. 062/070) — entrada = primer login del día (medianoche local); salida = cierre de sesión manual.
- **Ajustes** — perfil, sucursales, precios/tiempos por tipo de máquina, topes por carga, **costo de empaquetado**, alertas, logo, y **catálogos editables** (telas, tamaños de edredón, marcas y envases). Se reordenan arrastrando (Pointer Events, mig. 069). Datos que salen impresos en el ticket: **R.F.C. del negocio** (mig. 091/092, texto libre en mayúsculas) y la sección **Ticket** con el campo **Nota** (mig. 094), la letra chica del pie.
- **Notificaciones** (mig. 040/041/058) — alertas descartables con folio y limpieza periódica.
- **Cierre del día** — job que a la hora local configurada libera máquinas, pasa sus notas a `LISTA` y cierra sesiones de empleados.

- **Captura de notas (repaso de UI, 2026-08-31)** — Autoservicio y Por Encargo comparten la sección de **Productos**: fila compacta que se acomoda en pantalla angosta, alta desde un **modal con el catálogo** (con "Sin existencias" y "Ya está en la carga/nota"), sin opción de *cambiar* producto (se borra y se agrega el correcto) y total de productos al pie. En Autoservicio el pie es **"Aceptar" → modal de cobro** con la forma de pago y el botón de crear, y las cargas se pueden **quitar desde su tarjeta** (de la 2 en adelante, renumerando).
- **Salidas — asignar máquinas** — el modal de "Asignar Máquina" pregunta **dónde va** la máquina: *carga nueva* (lo de antes) o una **carga existente con hueco libre**, con la etiqueta de lo que le falta ("falta secadora"). Al elegir una carga se filtra la lista al hueco disponible y solo cabe una máquina por hueco. En **Autoservicio no se pregunta el cobro**: todas las cargas se cobran; la elección "Por cobrar / Sin cobro" sigue viva solo en Por Encargo.
- **Salidas — agregar productos a una nota en curso** — control de cantidad igual al de los formularios (arranca en 0, topa en lo disponible), **advertencia antes de agregar y antes de quitar** con lo que se cobra y lo que queda en inventario, y **suma sobre el renglón existente** si el producto ya está en la nota (`reservarProducto`, en vez de abrir un segundo renglón igual).

### En proceso / pendiente de cerrar
- **Sonoff, primera prueba real** — el código está desplegado y activo con credenciales reales. Falta **capturar el Device ID de cada Sonoff** en Gestión de Máquinas (app eWeLink → dispositivo → engrane → *Device ID*) y verificar con **"Probar enlace"** y **"Encender 5 segundos"** sobre un equipo físico.

### Pendientes / no iniciados
- **Fase 2 de Sonoff**: control local en la red de la lavandería (sin nube ni cuotas). El driver está aislado justo para que sea reemplazarlo, no rehacer la integración.
- **Pruebas de las páginas de frontend** (ver §5).

---

## 4. Decisiones técnicas relevantes (tomadas durante el desarrollo)

- **Versión visible en el login y atada a `package.json`**: el cliente opera desde su propia tablet, así que la forma más barata de saber qué build tiene es que él lea el número en la pantalla de entrada. Se ata a `package.json` (y no a un archivo aparte o al hash de git) para que subir versión sea editar una línea y desplegar.
- **Sonoff por nube y no por red local** (Fase 1): el backend vive en Fly.io/Dallas y no alcanza la red de la lavandería, así que se controla vía nube eWeLink. Se descartó por ahora la auto-detección de fin de ciclo: el temporizador actual es la aproximación.
- **Enganche del Sonoff en la BD, no en los controllers**: trigger + `pg_notify` + listener, en vez de llamar a la sincronización desde las ~13 funciones que cambian el estado de una máquina. **`LISTEN/NOTIFY` sí funciona sobre el session pooler de Supabase** — confirmado en producción el 2026-08-28 (`Listener Sonoff activo (LISTEN maquina_sync).` en los logs de arranque). El enganche por evento responde al instante; el reconciliador de 3 min queda solo como respaldo.
- **La simulación jamás se reporta como enlace confirmado**: con `DISPOSITIVOS_DRIVER` en `null`, cualquier `device_id` responde `ok`. Marcar `enlazada` en ese caso pintaría de verde una máquina sin hardware detrás, así que `esSimulacion()` corta tanto en `probarSonoff` como en `sincronizarSonoff` y la UI avisa en ámbar.
- **Un `device_id`+canal no puede repetirse entre máquinas**: se valida en el controller (no con constraint, para dar un mensaje útil) y **entre todas las sucursales**, porque el Sonoff es un aparato físico único. Un mismo `device_id` con canal distinto sí es válido (multi-relé).
- **Parámetros de Postgres casteados explícitamente**: el `UPDATE` de `updateMaquina` usaba `$12` como `varchar` en la asignación y como `text` dentro de un `CASE`, y Postgres rechazaba la consulta entera (`inconsistent types deduced`). Guardar cualquier máquina devolvía 500. Ahora `$12::varchar` en todos sus usos.
- **El ticket viaja como imagen porque `wa.me` solo acepta texto**: no existe forma de adjuntar un archivo a un número por URL, así que el PNG se entrega por la **Web Share API**, que en celular abre la hoja de compartir con la imagen ya adjunta. El costo es que **no se puede prellenar el destinatario**: el empleado elige el chat. En escritorio se cae al camino viejo (descarga del PNG + `wa.me` con el texto), y por eso `armarTextoTicket` sigue vivo.
- **En el ticket, la carga de Por Encargo se cobra al tope, no a la suma de lo que lleva dentro**: el desglose anterior mostraba el costo interno ($120) mientras el total decía el precio real ($150), porque el tope del tamaño *es* el precio de la carga. La línea del ticket usa `ajustes.tope_carga_*` (expuesto por carga como `tope_carga` en `GET /notas/:id`) + el ajuste manual, de modo que las líneas siempre suman el total.
- **Los valores del recibo llevan `whitespace-nowrap`**: al rasterizar con `skipFonts` cambian las métricas de la fuente y montos, fechas y "CARGA 1" se partían en dos renglones dentro del PNG. `skipFonts` es necesario porque la hoja de Google Fonts es de otro origen y leerla para embeberla lanza `SecurityError`.
- **El R.F.C. del negocio es texto libre en mayúsculas y se imprime tal cual**: sin validación de formato ni límite de largo (columna TEXT), porque la clienta quiere escribir ahí lo que necesite. El ticket no le antepone ninguna etiqueta: si quiere que diga "R.F.C. …", lo escribe dentro del campo. Se llegó a agregar también un campo **CURP**, descartado antes de desplegarlo (mig. 093 lo elimina).
- **Exportación PDF/CSV sin librerías**: base compartida en `lib/exportUtils.js` (CSV como `Blob`, PDF por ventana + `window.print()`), reutilizada por Cortes, Ventas y Reporte diario. Evita sumar ~500 KB de jsPDF al bundle.
- **Renombres de raíz aprovechando que no hay datos**: `productos.categoria` → **`marca`** (mig. 071) y `notas.modalidad` → **`tipo_servicio`** (mig. 072). Los **valores** no cambian; solo el nombre del campo.
- **El entorno de pruebas es una sucursal, no un modo de la app**: todo el sistema ya filtraba por `req.sucursal`, así que aislar a los usuarios de prueba fue crear una sucursal oculta y atarlos a ella — cero cambios en los módulos. Antes tenían `sucursal = NULL` y el backend los mandaba a `lopez_cotilla`, o sea que **sus pruebas ensuciaban los datos reales**. Los ajustes sí son globales (una sola fila `ajustes`), y por eso hizo falta el bloqueo explícito `bloquearPruebaGlobal`: lo que no vive en una sucursal hay que protegerlo a mano.
- **En Autoservicio toda carga se cobra**: la pregunta "Por cobrar / Sin cobro" al asignar una máquina extra solo tiene sentido en Por Encargo, donde una carga puede ir de cortesía. En Autoservicio era un paso de más y un riesgo de dejar dinero sin cobrar.
- **Una carga admite a lo más una lavadora y una secadora** (contando las ya usadas y liberadas): por eso asignar a una carga existente llena un hueco, y el `UPDATE` usa `COALESCE` para no pisar la máquina ni el precio que la carga ya traía.
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
- **Ventas muestra DOS totales, no uno** (`total_general` y `total_cobrado`): la *suma de conceptos* (cargas + productos + ajustes) responde de dónde vino el dinero; el *total cobrado* (suma de `precio_total`) es lo que realmente entró y lo que cuadra con el corte de caja. Difieren cuando el tope de Por Encargo fija el precio de la carga, así que la pantalla y el export explican la diferencia en vez de dejar un descuadre aparente. Elegir uno solo habría escondido información: el viejo `TOTAL GENERAL` subestimaba el ingreso.
- **Cierre del día in-process** (no cron): por eso la máquina de Fly se mantiene siempre encendida.
- **Proxy en `_redirects` y no en `netlify.toml`**: duplicar el catch-all rompía el proxy `/api`.
- **Login de `admin_main` con prefijo `***`**.

---

## 5. Problemas abiertos / pendientes de decidir

- **Sonoff sin probar contra hardware real**: todo el camino de eWeLink (firma HMAC, endpoints, región) está escrito, cubierto por pruebas con `fetch` mockeado y **ya desplegado con credenciales reales**, pero **nunca corrió contra la API real ni contra un dispositivo**. Sigue siendo el riesgo técnico vivo más grande del proyecto. Si el login falla, los primeros sospechosos son `EWELINK_COUNTRY_CODE` (debe ser el país donde el cliente registró su cuenta) y `EWELINK_REGION`; se ve en `fly logs`.
- **Credencial de eWeLink a nombre de la desarrolladora, no del cliente**: la aplicación se creó con la cuenta personal. Migrarla al cliente después es barato (cambiar `EWELINK_APP_ID`/`SECRET` en Fly; los Device IDs viven en la BD y no se tocan), pero implica repetir la aprobación de 1-2 días.
- **La credencial gratuita vence al año** (creada el 2026-08-28 → vence alrededor del **2027-08-28**) y **no está documentado si la renovación sigue siendo gratis** (la página de precios de CoolKit dice "gratis por ahora" y no habla de renovación; el contacto para preguntar es `bd@coolkit.cn`). Si dejara de ser gratis, la lavandería **no se queda parada**: `sincronizarSonoff` nunca lanza, así que un fallo solo marca la máquina "Sin conexión" y se vuelve al manejo manual.
- **La contraseña de eWeLink del cliente está guardada como secreto en Fly** (lo exige el login de la API v2). Si el cliente la cambia, el control de máquinas se cae hasta actualizar `EWELINK_PASSWORD`. Conviene avisarle.
- **Los usuarios de prueba comparten contraseña entre local y producción** (`Prueba1234`, sembrada el 2026-09-02). La clienta quedó de cambiarla ella: `fly ssh console -a lavanderia-el-sol-api -C "node db/seed_pruebas.js <nueva>"` (mínimo 8 caracteres, aplica a los dos usuarios a la vez y no duplica máquinas ni productos).
- **El envío del ticket ya no prellena el chat del cliente**: la hoja de compartir no admite destinatario. Es el precio de mandar imagen en vez de texto; si estorba en el uso real, la alternativa es volver al texto.
- **Enum legacy `EDREDON` en `tipo_servicio`**: sigue existiendo por compatibilidad; la prenda Edredón va en `tipo_prenda`.
- **Bundle único grande** (~1.16 MB, ~308 KB gzip): Vite avisa del tamaño; sin code-splitting todavía. No es urgente.
- **Base de desarrollo vaciada (2026-08-31)**: la base local `lavanderia_el_sol` se dejó **sin notas, inventario, cajas ni check-ins** para empezar de cero, y se eliminaron **6 productos duplicados** que venían de un sembrado doble. Se conservan usuarios, sucursales, clientes, máquinas, ajustes y catálogos. **Producción (Supabase) no se tocó.**
- **Pruebas de frontend incompletas**: hay helpers, componentes con lógica y la página **Login** (56 casos, todos en verde). **Faltan las páginas restantes**, la prioritaria es **`NuevaNota`** (formulario complejo de cargas/productos con tarifas y topes); luego `Empleados`, `Ventas`, `Notas`, `Caja`, `Inventario`. El backend sí está cubierto por completo (**23 unit + 203 de integración en 15 archivos, todas en verde el 2026-09-02**). Lo nuevo del entorno de pruebas y de la asignación de máquinas a una carga existente **no tiene pruebas propias todavía**: se verificó a mano contra la API (local y producción).

---

## 6. Próximo paso inmediato

1. **Capturar en Ajustes** el **R.F.C.** y la **nota al pie** del ticket que quiera el negocio: las migraciones ya están en producción (release v27), los campos están vacíos.
2. **Reunir los Device IDs**: en la app eWeLink del cliente, entrar a cada dispositivo → engrane → *Device ID*, anotando a qué máquina corresponde y, si es multi-relé, qué canal.
3. **Enlazar una sola máquina primero**: capturar su Device ID en Gestión de Máquinas, darle **"Probar enlace"** y luego **"Encender 5 segundos"** con el equipo vacío y a la vista. Esta es la **primera prueba contra hardware real** de todo el camino de eWeLink.
4. **Si falla**, revisar `fly logs -a lavanderia-el-sol-api`: los sospechosos son `EWELINK_COUNTRY_CODE`, `EWELINK_REGION` y la firma del login.
5. **Capturar el resto de las máquinas** solo cuando la primera funcione.
6. **Entregar el sistema al cliente** para que empiece el uso real, avisándole que si cambia su contraseña de eWeLink hay que actualizar el secreto en Fly. Antes de entregar, **subir la versión** en `frontend/package.json` (hoy 1.0.0) y **cambiar la contraseña de los usuarios de prueba**.

**Pendiente de pruebas (para retomar):** cubrir las **páginas del frontend**, empezando por **`NuevaNota`** (patrón ya validado en `Login` y en los modales). Las fixtures obsoletas de `calculosNotas.test.js` ya se arreglaron.

**Trabajo más reciente (2026-09-01/02):** **Salidas** y el **entorno de pruebas**.

- **Autoservicio y Por Encargo dejaron de compartir el mismo modal de asignar máquina.** En Autoservicio desapareció la pregunta de Cobro (todo se cobra); en Por Encargo sigue igual.
- **Asignar una máquina ya no obliga a abrir una carga nueva.** El modal pregunta dónde va: carga nueva o una carga existente con hueco (el caso que lo motivó: la Carga 1 tiene lavadora y hay que sumarle la secadora, que antes se iba a una Carga 2). En el backend, `carga_id` dejó de exigir que la carga esté vacía: llena el hueco libre con `COALESCE`, sin pisar la máquina ni el precio que ya traía, y rechaza el hueco ocupado con un mensaje por carga.
- **Los usuarios de prueba quedaron aislados en una sucursal oculta** (mig. 095). Antes tenían `sucursal = NULL`, así que el backend los mandaba a `lopez_cotilla` y **escribían sobre los datos reales**. Ahora operan en `pruebas`, nadie más la ve (ni el `admin_main`), no pueden salir de ella ni cambiar ajustes, sucursales, personal ni catálogos. Desplegado y **verificado contra la API de producción** el mismo día (release v27 + `seed_pruebas.js` en Fly).

**Trabajo anterior (2026-08-31/09-01):** tanda completa sobre el **ticket que recibe el cliente**.

- **Por Encargo dejó de enseñar las tripas de la carga.** Antes se listaban lavadora, secadora, bolsa, jabón y empaquetado; ahora es una línea, "1 × Servicio por encargo · Chica", con el tamaño y el precio. Al hacerlo salió un descuadre viejo: el desglose sumaba el **costo interno** ($120) mientras el total cobraba el **tope del tamaño** ($150). El ticket ahora cobra por tope (`tope_carga` viaja por carga en `GET /notas/:id`), así que las líneas cuadran con el total. También se quitó el renglón "Tipo", redundante con la nueva línea.
- **El ticket se manda como PNG, no como texto.** `html-to-image` rasteriza el recibo y se entrega por la hoja de compartir del celular (Web Share API) con la imagen adjunta; en escritorio se descarga el PNG y se abre `wa.me` con el texto. Se descubrió y corrigió que al rasterizar se partían montos y fechas en dos renglones (`whitespace-nowrap`).
- **Datos del negocio en el ticket** (mig. 091-094): **R.F.C.** —texto libre, en mayúsculas, impreso tal cual sin etiqueta— y una sección nueva de Ajustes llamada **Ticket** con el campo **Nota**, que se imprime en letra chica al pie del recibo. Se probó un campo **CURP** al lado y se descartó antes de desplegarlo (mig. 093 lo borra).

**Trabajo anterior (2026-08-30/31):** repaso largo de la **interfaz de captura y cobro**, con tres arreglos de fondo que salieron por el camino:

- **Salidas mostraba un precio y cobraba otro.** El panel de agregar productos leía siempre `precio_unitario` y el stock en tapas, sin mirar el servicio de la nota; en Autoservicio el backend descuenta una **botella** y cobra `precio_botella`. Ahora la pantalla usa la misma regla que el cobro (unidad, stock convertido y precio), y por eso un producto de marca sin precio por tapa ya no aparece como "sin precio".
- **El resumen de Autoservicio decía "sin máquinas"** aunque la carga tuviera lavado y secado: leía la máquina física, que en ese servicio se asigna después en Salidas. Ahora desglosa el tipo elegido con su tarifa, y lo mismo se corrigió en el **ticket**.
- **Agregar dos veces el mismo producto abría dos renglones.** `reservarProducto` ahora suma sobre el existente, con una prueba de integración nueva (`test/integration/notaProductosSuma.test.js`) que también cubre el tope de stock.

Además: **productos nombrados igual en toda la app** (marca y "Granel" para distinguir dos que se llaman igual, orden granel → marca → bolsas), **cobro de Autoservicio en un modal** al pulsar "Aceptar", cargas que se pueden **quitar desde su tarjeta**, jerarquía tipográfica y aire revisados en **Ajustes** (encabezados de grupo por encima de las etiquetas de campo, tarjetas en móvil), **Ajustes y Salir al pie del sidebar** cuando todos los iconos caben, nomenclatura **Lavadora/Secadora** y tamaño **"Chica"**, y un **punto azul en el login** que marca versión nueva hasta el siguiente cierre del día. Se arreglaron las **5 pruebas en rojo** que arrastraba el proyecto (3 de integración por el contrato de cobro con forma de pago, 2 unitarias por el modelo de precio por unidad) y se añadió la **skill `/run-lavanderia-el-sol`** para levantar y revisar la app.

**Trabajo anterior (2026-08-28):** se **puso en marcha el control Sonoff en producción**. Se creó la aplicación en el portal de eWeLink (OAuth2.0 / Standard Role), se cargaron los 7 secretos en Fly con `fly secrets import --stage` y se desplegó el **release v25**, que aplicó las migraciones 074-090 pendientes en prod. Los logs de arranque confirmaron `Listener Sonoff activo (LISTEN maquina_sync).` y `Reconciliador Sonoff activo (cada 3 min).`, lo que **cierra el riesgo abierto de si `LISTEN/NOTIFY` funcionaba sobre el session pooler de Supabase** — sí funciona. No hubo cambios de código en este paso: fue configuración y despliegue. Antes de eso (2026-08-27): forma de pago obligatoria en todo cobro, con **tarjeta** como opción nueva (mig. 090), y corte de caja que **ya no cuenta transferencias ni tarjetas como efectivo** (commit `9bea213`); reporte de Ventas con **la suma de conceptos y el total cobrado por separado**; mejoras a Gestión de Máquinas para la puesta en marcha del Sonoff, incluida la corrección de un **500 que rompía el guardado de cualquier máquina**.
