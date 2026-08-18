# Contexto técnico — Lavandería El Sol

> Documento para pegar al inicio de una conversación nueva con Claude. Técnico y directo.
> Última actualización: 2026-08-17.

---

## 1. Resumen del proyecto

Sistema web de gestión para una lavandería (**Lavandería El Sol**): clientes, notas (autoservicio y por encargo), máquinas, inventario (productos + insumos), caja, empleados y ventas. Usuarios: administradores y empleados del negocio (uso interno, no cara al cliente final).

**Estado de uso:** la infraestructura ya está desplegada en producción (Netlify + Fly.io + Supabase, desde 2026-06-22), pero el sistema **todavía no está en uso real** en la lavandería. Antes de entregarlo al cliente falta la **configuración física de los Sonoff** para enlazarlos con las lavadoras; cuando eso funcione se hace la entrega. Como aún no hay datos reales, se pueden correr migraciones y renombres de raíz con libertad.

Dos entornos que conviven: **(1) local** — desarrollo contra Postgres local; **(2) nube** — producción. Se desarrolla en local y se promueve a nube con `git push` / `fly deploy`.

---

## 2. Stack y arquitectura actual

### Frontend
- **React 19** + **Vite 7** + **Tailwind CSS 3.4**. JSX puro, **sin TypeScript**.
- **react-router-dom 7** (ruteo SPA).
- Extras: **recharts 3** (gráficas en Ventas/Desempeño), **react-barcode** (folios).
- ESLint 9 (flat config). Gestor de paquetes: **pnpm**.
- **Pruebas: Vitest + Testing Library** (`environment: jsdom`, `setupFiles: src/test/setup.js`), `pnpm test` / `test:watch`. **51 casos**: helpers puros de `lib/`, la página **Login**, y componentes con lógica (KpiCard, SalesCard, MachineCard, CircularTimer, EmpleadoDeleteModal, EmpleadoEditModal, CashCutCard, SucursalSelector). `api`/`useAuth`/`useNavigate` se mockean con `vi.mock`/`vi.hoisted`.
- Sin librería de estado global (Redux/Zustand): estado local + un `AuthContext`. Cliente HTTP propio en `lib/api.js` (fetch envuelto), no axios.

### Backend
- **Node + Express 5**, ESM (`"type": "module"`).
- **PostgreSQL con `pg` (SQL crudo parametrizado), sin ORM** (nada de Prisma/Sequelize). Toda la lógica vive en controllers.
- **JWT** (`jsonwebtoken`) + **bcrypt** para auth. **multer** para subir el logo. **dotenv**, **nodemon** en dev.
- **Seguridad HTTP:** `helmet` (cabeceras) y `express-rate-limit` (limiters de login y de búsqueda) en middleware.
- **Pruebas: Vitest.** Unit sin BD (`pnpm test`, 15 casos) e integración con `supertest` + Postgres desechable (`pnpm test:integration`, `test:all` corre ambas). **173 casos** de integración que cubren **todos los controllers por HTTP** (auth, notas, caja, ventas, clientes, productos, insumos, maquinas, ajustes, sucursales, etiquetas, notificaciones, usuarios) **y el job de cierre del día** (funciones importadas directo). Para poder montar la app en tests, `app.js` exporta la app y `index.js` solo hace `listen` + jobs. Arnés en `test/` (bootstrap de la BD, seeds `seedSucursal/Usuario/Maquina/Cliente/Producto/Insumo/Ajustes/Login/Notificacion`, tokens). Las funciones puras de precios/secado/folio viven en `utils/calculosNotas.js`.
- Jobs in-process con `setInterval` (no cron externo, no colas).

### Base de datos
- PostgreSQL. **Local:** variables `DB_*`. **Prod:** Supabase vía **Session pooler (IPv4, 5432)** con SSL, usando `DATABASE_URL`. `db/pool.js` elige según exista `DATABASE_URL`.
- **Migraciones caseras**: archivos SQL numerados en `db/migrations/`, runner idempotente (`db/migrate.js`) que registra lo aplicado en `schema_migrations`. Bootstrap = `schema.sql` + migraciones en orden. Van por la **073**. La tabla base histórica se llamaba `ordenes` y fue renombrada a `notas` (mig. 009); `schema.sql` conserva el nombre viejo solo como bootstrap y las migraciones posteriores lo renombran.

### Despliegue
- **Frontend → Netlify** (`chic-banoffee-20c2e3.netlify.app`), base `frontend/`. Proxy `/api` y `/uploads` → Fly y fallback SPA en `frontend/public/_redirects` (en ese orden; **no** duplicar el catch-all en `netlify.toml`).
- **Backend → Fly.io** (`lavanderia-el-sol-api`, región `dfw`). Máquina **siempre encendida** (`min_machines_running = 1`) porque el job de cierre del día corre in-process. Migraciones corren como `release_command` en cada deploy. Volumen `uploads` para conservar el logo.
- **DB → Supabase**.

### Estructura del repo (resumen)
```
backend/
  index.js                # helmet + registra rutas /api/*
  controllers/            # 1 por dominio: auth, notas, caja, maquinas, ventas,
                          #   clientes, productos, insumos, etiquetas,
                          #   notificaciones, sucursales, usuarios, ajustes
  routes/                 # 1 por dominio; verifyToken + sucursalActiva
  middleware/             # auth (JWT + sesión única), roles, sucursalActiva, rateLimit
  jobs/                   # cierreDelDia, limpiezaNotificaciones (setInterval)
  utils/                  # calculosNotas (precios/secado/folio, puro), nombres, tz
                          #   + *.test.js (Vitest unit)
  test/                   # integración: helpers/seeds + integration/*.test.js
                          #   (1 archivo por dominio) + bootstrapDb/globalSetup
  db/                     # pool, schema.sql, migrations/, migrate.js, seed.js
frontend/src/
  pages/                  # Dashboard, Notas, NuevaNota, DetalleNota, TicketNota,
                          #   Maquinas, MaquinaUso, GestionMaquinas, Salidas,
                          #   Inventario, Caja, Ventas, Clientes, Empleados,
                          #   EmpleadoDesempeno, Ajustes, Login,
                          #   SeleccionarSucursal
  components/             # Layout, AdminRoute, KpiCard, MachineCard, ...
                          #   + *.test.jsx (Testing Library)
  context/AuthContext.jsx
  lib/                    # api.js, roles.js, telefono.js, texto.js (+ *.test.js)
  test/setup.js           # jest-dom + stub de matchMedia para las pruebas
info/                     # referencias de diseño (Figma export, docx) — no es código
```

### Diferencias vs. lo que uno esperaría del plan inicial
- **Sin integración con hardware/Sonoff/IoT/MQTT en el código**: el control de máquinas es **manual** (cambios de estado en la BD desde la UI). El enlace físico Sonoff↔lavadoras es previo a la entrega y externo al sistema (no hay relés ni comunicación con dispositivos en el código).
- **Sin sincronización offline / PWA / service worker**: la app es **online-only** (fetch directo). No hay IndexedDB ni cache local.
- **Sin websockets**: el "tiempo real" del Dashboard es **polling** (cada 15 s con `setInterval`, y al volver a la pestaña). Suficiente para el volumen actual.
- **Migraciones caseras en vez de herramienta de migración** (por simplicidad y control total del orden).

---

## 3. Estado por módulo

> El plan de fases original no está versionado en el repo; el estado se mapea a los **módulos funcionales** ya implementados.

### Completos
- **Auth y roles** — JWT; jerarquía `admin_main > admin > operador`. `AdminRoute` protege vistas de admin. `admin_main` inicia sesión tecleando prefijo `***` antes del nombre. **Sesión única** por cuenta (mig. 054): un `session_id` invalida sesiones previas. Rate-limit en login.
- **Multisucursal** (mig. 038/039) — header `X-Sucursal` + middleware `sucursalActiva`; el admin es **global** (mig. 059) y cambia de sucursal (pantalla `SeleccionarSucursal`), al operador se le fuerza la suya. Sucursales con contacto editable.
- **Clientes** — CRUD, búsqueda sin acentos (`unaccent`), nombre + apellido + teléfono.
- **Notas** — autoservicio y por encargo; folios; estados (`EN_ESPERA → LAVANDO → SECANDO → LISTA → PAGADA/FINALIZADA`, + `CANCELADA`; mig. 049) con historial (mig. 036) y `pagado` (mig. 037); productos e insumos asociados; edición y cancelación; ticket imprimible (`TicketNota`).
- **Modelo por cargas** (mig. 046-048/057) — cada nota se compone de **cargas** (`nota_cargas`), y cada carga lleva su lavadora y su secadora; en Por Encargo, además, su prenda, tela/tamaño de edredón, tamaño de carga, ajuste y productos. Autoservicio admite N cargas por nota. Se registran las máquinas **usadas** por carga (mig. 048) y hay marca de carga "adicional" (mig. 057) y de máquina removida (mig. 056). **Es el único modelo:** la ruta/denormalización legada (`notas.maquina_id`/`secadora_id`/`precio_base`/`cantidad_cargas`) se eliminó por completo (mig. 073); toda máquina y todo total se derivan de `nota_cargas`.
- **Máquinas y Salidas** — catálogo, estados, uso/liberación, **tamaño de máquina** (mediana/jumbo, mig. 055), tiempos por tipo, páginas de uso (`MaquinaUso`), gestión (`GestionMaquinas`) y `Salidas`. En **Salidas** se **termina el ciclo** (la carga pasa a "Por Entregar") o se detiene la máquina; se puede agregar una secadora a una nota con la lavadora ya en uso.
- **Inventario — Productos** — CRUD; **marca** del producto (catálogo editable, antes "categoría"; mig. 063→071); productos líquidos **por tapa/medida** con rendimiento calculado por volumen (mig. 064/067); **stock mínimo** por producto (mig. 065); **archivar/restaurar** en vez de borrar los usados en notas (mig. 066); stock reservado vs. disponible.
- **Inventario — Insumos** — CRUD con su propia `categoria` (concepto aparte de la marca de producto).
- **Caja** (mig. 033) — apertura, movimientos, corte e historial. Caja **compartida** (una abierta a la vez, garantizada por índice único parcial). El corte muestra la diferencia en verde/rojo/azul.
- **Ventas / reportes** — resumen por periodo, gráficas (recharts), desempeño por empleado.
- **Empleados** — alta con `nombre` + `apellido` (mig. 061), marca de **usuario de prueba** (mig. 060), y **Desempeño por día** (`EmpleadoDesempeno`) con filtro por rango/mes/año y modales de detalle por métrica.
- **Check-in / salida de empleados** (mig. 062/070) — la hora de entrada = primer login del día (medianoche local); la salida = cierre de sesión manual (o el cierre del día la deja en "—"). Se ven en Desempeño por día.
- **Ajustes** — perfil, sucursales, precios/tiempos por tipo de máquina, topes de precio por carga, alertas, logo, y **catálogos editables**: etiquetas de encargo (tipos de tela, tamaños de edredón) e inventario (marcas y envases de producto). Los catálogos se reordenan arrastrando (Pointer Events, mig. 069) y piden confirmación al agregar.
- **Notificaciones** (mig. 040/041/058) — alertas (p. ej. ciclo detenido), descartables, con folio de la nota y limpieza periódica.
- **Cierre del día** — job que a la hora local configurada libera máquinas en uso, pasa sus notas a `LISTA` y cierra las sesiones de empleados (deja salida en "—").

### En proceso / pendiente de cerrar
### Pendientes / no iniciados
- Método de pago y timestamp real de cobro en `notas` (hoy no existen; ver limitación de Caja).
- Integración física de máquinas / Sonoff (fuera del alcance del código; es setup previo a la entrega).

---

## 4. Decisiones técnicas relevantes (tomadas durante el desarrollo)

- **Renombres de raíz aprovechando que no hay datos** (antes de entregar): `productos.categoria` → **`marca`** (columna + tabla `categorias_producto` → `marcas_producto` + endpoint `/etiquetas/marcas-producto`; mig. 071) y `notas.modalidad` → **`tipo_servicio`** (columna + enum `modalidad_orden` → `tipo_servicio` + índice; mig. 072). En ambos los **valores** no cambian; solo el nombre del campo. La `categoria` de **insumos** y la "categoría de secado" son conceptos distintos y NO se tocaron.
- **Convención de nombres**: columnas y llaves del wire (payloads JSON) en **snake_case** (`cliente_id`, `tipo_servicio`); variables locales de React en camelCase (p. ej. el estado `tipoServicio`).
- **Modelo por cargas (`nota_cargas`)** (mig. 046-048): una nota es un conjunto de cargas y cada carga es autónoma (sus máquinas y, en encargo, prenda/tela/tamaño/ajuste/productos). Es el **único** modelo: `createNota` exige `cargas`, y máquinas/total salen siempre de `nota_cargas`. La denormalización legada a nivel nota se eliminó (mig. 073, ver arriba).
- **Secado por tipo de carga** (mig. 051): el secado cobra y cronometra por categoría (Mediana/Jumbo/Edredón), "igual que su lavadora". La duración del ciclo se **sella en `maquinas.ciclo_minutos`** al poner la máquina en uso (`sellarCicloMaquinas`) y los temporizadores la leen de ahí. Tarifa en `tarifaSecadora`/`categoriaSecado`.
- **Tiempo de lavado de Edredón** (mig. 053): el lavado de edredón (siempre en jumbo) tiene su propio `tiempo_edredon_jumbo`. `sellarCicloMaquinas` sella `ciclo_minutos` también de las **lavadoras** (no solo secadoras).
- **Topes de precio por carga** (mig. 050/052): precio máximo por tamaño de carga chica/grande/jumbo (NULL = sin tope) y un cuarto tope dedicado a cargas de **Edredón**. El tope limita `lavadora + secadora + productos de la carga`; el **ajuste manual no cuenta** y es **tope duro para todos los roles**, incluido admin. Se valida en backend antes del COMMIT (`validarTopesCargas`) y NuevaNota muestra el presupuesto restante. Solo Por Encargo.
- **Estados por fase de máquina** (mig. 049): `EN_PROCESO` se dividió en `LAVANDO`/`SECANDO`. La fase la dictan las máquinas: `LAVANDO` mientras la nota conserve alguna lavadora vinculada y en uso; `SECANDO` cuando solo le quedan secadoras (la frontera la marca `terminar-lavado`). La nota permanece en su fase hasta que el empleado termina el ciclo.
- **`tipo_prenda` separado de `tipo_servicio`** (mig. 030): antes la modalidad `EDREDON` mezclaba "tipo de servicio" con "tipo de prenda". Ahora `tipo_servicio` = AUTOSERVICIO/POR_ENCARGO y `tipo_prenda` = ROPA/EDREDON. `EDREDON` queda en el enum de `tipo_servicio` solo por compatibilidad histórica.
- **Productos por tapa/medida** (mig. 064/067): productos líquidos se consumen por "tapa"; el rendimiento en tapas se calcula desde el volumen del envase y el tamaño de la tapa (mL). El stock se guarda en tapas y se muestra en envases.
- **Catálogos editables, no enums** (etiquetas de encargo e inventario): tela, tamaño de edredón, marca y envase viven en tablas editables desde Ajustes; la nota/producto guarda el **texto** (no FK) para conservar el valor si el catálogo cambia. Se **desactivan** (no se borran) y se reordenan a mano.
- **Sesión única** (mig. 054): cada login genera un `session_id`; el middleware de auth rechaza tokens con `sid` distinto al vigente.
- **Admin global** (mig. 059) + **usuario de prueba** (mig. 060): el admin no está atado a una sucursal; el flag de prueba sustituye la detección por nombre.
- **Check-in por primer login** (mig. 062/070): sin fichaje aparte; la entrada es el primer login del día (medianoche local) y la salida es el cierre manual de sesión.
- **Folios `SEQ-DDMMYY`**: `generarFolio(id, fecha)` → id con padding a 4 + fecha (ej. `0042-090726`).
- **`stock_disponible` nunca se persiste**: siempre `stock_actual - stock_reservado`. Agregar/quitar producto reserva/libera; pagar descuenta y libera en una transacción.
- **Caja compartida por índice único parcial** (`WHERE estado = 'abierta'`): una sola caja abierta en todo el negocio; abrir una segunda devuelve 409.
- **"Ventas de la sesión" de caja por proxy de `created_at`**: como `notas` no guarda método ni hora de cobro, se suman las pagadas cuyo `created_at` cae en la ventana de la caja. **Deuda consciente.**
- **Seguridad HTTP**: `helmet` para cabeceras y `express-rate-limit` para login y búsquedas.
- **Cierre del día in-process** (no cron): por eso la máquina de Fly se mantiene siempre encendida. Revisa periódicamente y dispara a la hora local configurada (`CIERRE_HORA`, `TZ_NEGOCIO`).
- **Proxy en `_redirects` y no en `netlify.toml`**: poner el catch-all SPA en ambos rompía el proxy `/api`. El orden importa.
- **Login de `admin_main` con prefijo `***`**: los `admin_main` no se listan por nombre; hay que teclear `***Nombre`.

---

## 5. Problemas abiertos / pendientes de decidir

- **Enlace físico Sonoff↔lavadoras pendiente**: es el paso que falta antes de entregar el sistema al cliente y ponerlo en uso real.
- **`notas` sin método de pago ni hora de cobro** → Caja no distingue efectivo vs. tarjeta y usa `created_at` como proxy del cobro. Si se necesita precisión contable, hay que agregar esos campos.
- **Enum legacy `EDREDON` en `tipo_servicio`**: sigue existiendo por compatibilidad; conviene no reutilizarlo para notas nuevas (la prenda Edredón va en `tipo_prenda`).
- **Bundle único grande** (~1.1 MB): Vite avisa del tamaño; sin code-splitting todavía. No es urgente.
- **Pruebas automáticas** (Vitest; ver §2): el backend está **cubierto por completo** —unit de lógica pura + integración con BD contra **todos** los controllers y el job de cierre (~188 casos back). En **frontend** hay helpers, todos los componentes con lógica y la página **Login** (~51 casos). **Falta cubrir las páginas restantes** (la prioritaria es **`NuevaNota`** —formulario complejo de cargas/productos con tarifas y topes—; luego `Empleados`, `Ventas`, `Notas`, `Caja`, `Inventario`). La integración necesita Postgres local corriendo; las unit y las de frontend no.

---

## 6. Próximo paso inmediato

- **Configurar los Sonoff** y enlazarlos con las lavadoras; una vez que funcione, **entregar el sistema al cliente** para que empiece el uso real.
- **Pendiente de pruebas (para retomar):** cubrir las **páginas del frontend**, empezando por **`NuevaNota`** (formulario de cargas/productos con tarifas y topes; requiere mockear `api` + router + contextos, patrón ya validado en `Login`/modales). Luego `Empleados`, `Ventas`, `Notas`, `Caja`, `Inventario`. El backend ya está cubierto por completo.
- El trabajo más reciente (2026-08-17) fue **una gran ampliación de la suite de pruebas**: de ~27 a **173 casos de integración** (todos los controllers + job de cierre del día) y de 14 a **51 de frontend** (se sumó **Testing Library** para componentes con lógica y la página **Login**). Antes de eso: eliminar la ruta/denormalización legada del modelo por cargas (mig. 073 — máquinas y totales se derivan siempre de `nota_cargas`) y montar Vitest, más los renombres `categoria`→**`marca`** (mig. 071) y `modalidad`→**`tipo_servicio`** (mig. 072).
