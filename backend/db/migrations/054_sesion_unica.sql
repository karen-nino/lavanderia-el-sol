-- Sesión única por cuenta: cada usuario tiene un identificador de sesión que se
-- regenera en cada login. El token JWT lleva ese mismo id (claim "sid") y el
-- middleware lo compara contra el guardado aquí. Al iniciar sesión en otro
-- dispositivo, el id cambia y los tokens anteriores dejan de ser válidos, así
-- que la sesión previa se cierra sola en su siguiente petición.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS session_id TEXT;
