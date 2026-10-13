import { Router } from 'express';
import { login, logout, getMe, updateMe, buscarUsuarios, demoLogin } from '../controllers/auth.controller.js';
import { verifyToken } from '../middleware/auth.js';
import { loginLimiter, busquedaLimiter, busquedaLimiterHora, demoLoginLimiter } from '../middleware/rateLimit.js';
import { ENTORNO_DEMO } from '../utils/entorno.js';

const router = Router();

router.post('/login',          loginLimiter, login);

// Solo en la demo pública: fuera de ella la ruta no existe (404 de Express).
if (ENTORNO_DEMO) router.post('/demo-login', demoLoginLimiter, demoLogin);

// El de minuto va primero: así una ráfaga rechazada no gasta el cupo de la hora.
router.get('/buscar-usuarios', busquedaLimiter, busquedaLimiterHora, buscarUsuarios);
router.post('/logout',         verifyToken, logout);
router.get('/me',              verifyToken, getMe);
// Las cuentas de prueba son compartidas: su perfil es de solo consulta.
const perfilDePruebaFijo = (req, res, next) => (
  req.user?.es_prueba && !ENTORNO_DEMO
    ? res.status(403).json({ message: 'El perfil de un usuario de prueba no se puede cambiar.' })
    : next()
);
router.patch('/me',            verifyToken, perfilDePruebaFijo, updateMe);

export default router;
