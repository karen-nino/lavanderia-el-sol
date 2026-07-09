# Contexto técnico — Lavandería El Sol

> Documento para pegar al inicio de una conversación nueva con Claude. Técnico y directo.
> Última actualización: 2026-07-09.

---

## 1. Resumen del proyecto

Sistema web de gestión para una lavandería (**Lavandería El Sol**): clientes, notas/pedidos (autoservicio y por encargo), máquinas, inventario, caja y ventas. Usuarios: administradores y empleados del negocio (uso interno, no cara al cliente final).

Dos etapas: **(1) local** — desarrollo contra Postgres local; **(2) nube** — ya desplegado en producción (Netlify + Fly.io + Supabase) desde 2026-06-22. Ambas conviven: se desarrolla en local y se promueve a nube con `git push` / `fly deploy`.

---

## 2. Stack y arquitectura actual

### Frontend
- **React 19** + **Vite 7** + **Tailwind CSS 3.4**. JSX puro, **sin TypeScript**.
- **react-router-dom 7** (ruteo SPA).
- Extras: **recharts** (gráficas en Ventas/Desempeño), **react-barcode** (folios).
- ESLint 9 (flat config). Gestor de paquetes: **pnpm**.
- Sin librería de estado global (Redux/Zustand): estado local + un `AuthContext`. Cliente HTTP propio en `lib/api.js` (fetch envuelto), no axios.

### Backend
- **Node + Express 5**, ESM (`"type": "module"`).
- **PostgreSQL con `pg` (SQL crudo parametrizado), sin ORM** (nada de Prisma/Sequelize). Toda la lógica vive en controllers.
- **JWT** (`jsonwebtoken`) + **bcrypt** para auth. **multer** para subir el logo. **dotenv**, **nodemon** en dev.
- Jobs in-process con `setInterval` (no cron externo, no colas).

### Base de datos
- PostgreSQL. **Local:** variables `DB_*`. **Prod:** Supabase vía **Session pooler (IPv4, 5432)** con SSL, usando `DATABASE_URL`. `db/pool.js` elige según exista `DATABASE_URL`.
- **Migraciones caseras**: archivos SQL numerados en `db/migrations/`, runner idempotente (`db/migrate.js`) que registra lo aplicado en `schema_migrations`. Bootstrap = `schema.sql` + migraciones en orden. Van por la **042**.

### Despliegue
- **Frontend → Netlify** (`chic-banoffee-20c2e3.netlify.app`), base `frontend/`. Proxy `/api` y `/uploads` → Fly y fallback SPA en `frontend/public/_redirects` (en ese orden; **no** duplicar el catch-all en `netlify.toml`).
- **Backend → Fly.io** (`lavanderia-el-sol-api`, región `dfw`). Máquina **siempre encendida** (`min_machines_running = 1`) porque el job de cierre del día corre in-process. Migraciones corren como `release_command` en cada deploy. Volumen `uploads` para conservar el logo.
- **DB → Supabase**.

### Estructura del repo (resumen)
```
backend/
  index.js                # registra rutas /api/*
  controllers/            # 1 por dominio (notas, caja, maquinas, ventas, etiquetas, ...)
  routes/                 # 1 por dominio; verifyToken + sucursalActiva
  middleware/             # auth (JWT), roles, sucursalActiva
  jobs/                   # cierreDelDia, limpiezaNotificaciones (setInterval)
  db/                     # pool, schema.sql, migrations/, migrate.js, seed.js
frontend/src/
  pages/                  # una por vista (Dashboard, Notas, NuevaNota, Caja, Ventas, Ajustes, ...)
  components/             # KpiCard, SalesCard, Layout, AdminRoute, MaquinasEnUso, ...
  context/AuthContext.jsx
  lib/                    # api.js, roles.js, telefono.js, texto.js
info/                     # referencias de diseño (Figma export, docx) — no es código
```

### Diferencias vs. lo que uno esperaría del plan inicial
- **Sin integración con hardware/Sonoff/IoT/MQTT**: el control de máquinas es **manual** (cambios de estado `disponible`/`en_uso`/`mantenimiento` en la BD desde la UI). No hay relés ni comunicación con dispositivos físicos en el código.
- **Sin sincronización offline / PWA / service worker**: la app es **online-only** (fetch directo). No hay IndexedDB ni cache local.
- **Sin websockets**: el "tiempo real" del Dashboard es **polling** (cada 15 s con `setInterval`, y al volver a la pestaña). Suficiente para el volumen actual.
- **Migraciones caseras en vez de herramienta de migración** (por simplicidad y control total del orden).

---

## 3. Estado por módulo

> El plan de fases original no está versionado en el repo; el estado se mapea a los **módulos funcionales** ya implementados.

### Completos y en producción
- **Auth y roles** — JWT; jerarquía `admin_main > admin > operador`. `AdminRoute` protege vistas de admin. `admin_main` inicia sesión tecleando prefijo `***` antes del nombre.
- **Multisucursal** (mig. 038/039) — header `X-Sucursal` + middleware `sucursalActiva`; el admin cambia de sucursal, al operador se le fuerza la suya. Sucursales con contacto editable.
- **Clientes** — CRUD, búsqueda sin acentos (`unaccent`), nombre + apellido + teléfono.
- **Notas / pedidos** — autoservicio y por encargo; folios; estados; historial de estados; productos e insumos asociados; edición y cancelación.
- **Máquinas** — catálogo, estados, uso/liberación, tiempos por tipo, página de uso y de gestión.
- **Inventario** — productos e insumos; stock reservado vs. disponible.
- **Caja** (mig. 033) — apertura, movimientos, corte e historial. Caja **compartida** (una abierta a la vez, garantizada por índice único parcial).
- **Ventas / reportes** — resumen por periodo, gráficas (recharts), desempeño por empleado.
- **Ajustes** — perfil, sucursales, precios/tiempos por tipo de máquina, alertas, logo, y **catálogos de etiquetas de encargo** (recién agregado).
- **Notificaciones** (mig. 040/041) — alertas (p. ej. ciclo detenido), descartables, con limpieza periódica.
- **Cierre del día** — job que a las 03:00 local libera máquinas en uso y pasa sus notas a `LISTA`.

### En proceso
- **Etiquetas de encargo (tipos de tela + tamaños de edredón)** — recién construido. Backend (mig. 042, catálogos CRUD, persistencia en `notas.tipo_tela` / `notas.tamano_edredon`), UI en NuevaNota, gestión en Ajustes y visualización en DetalleNota: **listos**. **Falta para cerrar:** aplicar la migración 042 en **producción** (por ahora solo corrió en local); validación en dispositivo real.
- **KPIs del Dashboard como accesos directos** — las 4 tarjetas + "Ingresado hoy" ya navegan (Máquinas, Notas, Notas filtradas por estado, Ventas solo-admin). **Falta para cerrar:** confirmar si se quieren más accesos o filtros adicionales.

### Pendientes / no iniciados
- Método de pago y timestamp real de cobro en `notas` (hoy no existen; ver limitación de Caja).
- Cualquier integración física de máquinas (no está en alcance actual del código).

---

## 4. Decisiones técnicas relevantes (tomadas durante el desarrollo)

- **`tipo_prenda` separado de `modalidad`** (mig. 030): antes la modalidad `EDREDON` mezclaba "tipo de servicio" con "tipo de prenda". Ahora `modalidad` = AUTOSERVICIO/POR_ENCARGO y `tipo_prenda` = ROPA/EDREDON. `EDREDON` queda en el enum solo por compatibilidad histórica.
- **Folios `SEQ-DDMMYY`**: `generarFolio(id, fecha)` → id con padding a 4 + fecha (ej. `0042-090726`). Legible para el mostrador y ordenable por id.
- **`stock_disponible` nunca se persiste**: siempre se calcula como `stock_actual - stock_reservado`. Agregar/quitar producto a una nota reserva/libera; pagar descuenta y libera en una transacción.
- **Caja compartida por índice único parcial** (`WHERE estado = 'abierta'`): garantiza una sola caja abierta en todo el negocio; abrir una segunda devuelve 409.
- **"Ventas de la sesión" de caja por proxy de `created_at`**: como `notas` no guarda método ni hora de cobro, se suman las `PAGADO` cuyo `created_at` cae en la ventana de la caja. **Deuda consciente.**
- **Etiquetas de encargo como catálogos editables, no enums**: tela y tamaño de edredón viven en tablas (`tipos_tela`, `tamanos_edredon`) editables desde Ajustes; la nota guarda el **texto** de la etiqueta (no FK) para que las notas viejas conserven su valor si el catálogo cambia. Son **solo etiquetas internas**: no afectan precio. Se desactivan (no se borran).
- **Cierre del día in-process** (no cron): por eso la máquina de Fly se mantiene siempre encendida. Revisa cada 5 min y dispara a la hora local configurada (`CIERRE_HORA`, `TZ_NEGOCIO`).
- **Proxy en `_redirects` y no en `netlify.toml`**: poner el catch-all SPA en ambos rompía el proxy `/api`. El orden importa.
- **Login de `admin_main` con prefijo `***`**: los `admin_main` no se listan por nombre; hay que teclear `***Nombre`.

---

## 5. Problemas abiertos / pendientes de decidir

- **`notas` sin método de pago ni hora de cobro** → Caja no distingue efectivo vs. tarjeta y usa `created_at` como proxy del cobro. Si se necesita precisión contable, hay que agregar esos campos.
- **Migración 042 pendiente en producción** (etiquetas de encargo): corrió solo en local.
- **Discrepancia semántica menor ya resuelta**, pero a vigilar: el KPI "Para Entregar" agrupa `LISTA` + `PAGADA`; el filtro de Notas se ajustó para coincidir. Cualquier cambio futuro de estados debe mantener ambos alineados.
- **Enum legacy `EDREDON` en `modalidad`**: sigue existiendo por compatibilidad; conviene no reutilizarlo para notas nuevas.
- **Bundle único grande** (~950 kB): Vite avisa del tamaño; sin code-splitting todavía. No es urgente.
- **Sin pruebas automatizadas** (`test` es un placeholder): validación es manual.

---

## 6. Próximo paso inmediato

- **Terminar "etiquetas de encargo"**: aplicar la **migración 042 en producción** (`fly deploy` la corre como `release_command`) y validar el flujo completo (crear encargo de Ropa con tela / de Edredón con tamaño → ver en DetalleNota; gestionar catálogos en Ajustes).
- **Seguir con los accesos directos del Dashboard** si se piden más (todas las tarjetas KPI ya navegan; "Ingresado hoy" es solo-admin).
