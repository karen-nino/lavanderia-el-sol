-- Migración 098: guardar la sesión OAuth de eWeLink
-- Fecha: 2026-09-02
--
-- El driver entraba a eWeLink con correo y contraseña (POST /v2/user/login),
-- pero ese endpoint NO está en la lista blanca de una credencial del plan
-- gratuito: responde "407 the path of request is not allowed with appid". La
-- única vía permitida es OAuth 2.0, donde la dueña de la cuenta autoriza una
-- sola vez y la app recibe un par de tokens.
--
-- Se guardan en la base y no en memoria a propósito: el access token dura 30
-- días, y si viviera en el proceso, cada reinicio de la máquina en Fly (un
-- despliegue, un reinicio automático) obligaría a pedirle al cliente que
-- autorizara de nuevo.
--
-- Una sola fila (id = 1): hay una única cuenta de eWeLink para toda la
-- lavandería, igual que `ajustes`.

CREATE TABLE IF NOT EXISTS ewelink_cuenta (
  id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Sesión vigente. NULL en las tres = no hay cuenta conectada todavía.
  access_token   TEXT,
  refresh_token  TEXT,
  region         TEXT,

  -- Cuándo caduca cada token, según lo que responde eWeLink (at ≈ 30 días,
  -- rt ≈ 60). Si el refresh token caduca, hay que volver a autorizar a mano.
  at_expira_at   TIMESTAMPTZ,
  rt_expira_at   TIMESTAMPTZ,

  -- Correo de la cuenta autorizada, solo para mostrarlo en pantalla y que se
  -- vea de un vistazo si quedó conectada la cuenta correcta.
  cuenta         TEXT,

  -- Flujo en curso: `state` de un solo uso que se genera al abrir la página de
  -- autorización y se verifica al volver, para que el callback (que es público,
  -- porque quien llega es eWeLink y no trae nuestro JWT) no acepte un code
  -- ajeno. Se limpia al consumirlo.
  state          TEXT,
  state_at       TIMESTAMPTZ,

  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO ewelink_cuenta (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
