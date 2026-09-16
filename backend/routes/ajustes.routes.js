import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { bloquearPruebaGlobal } from '../middleware/sucursalActiva.js';
import { getAjustes, updateAjustes, uploadLogo, upload, bloquearLogoEnDemo } from '../controllers/ajustes.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/',    getAjustes);
// Los ajustes son del negocio entero (tarifas, tiempos, ticket): los usuarios
// de prueba los leen, pero no los cambian.
router.patch('/',  bloquearPruebaGlobal, updateAjustes);
// bloquearLogoEnDemo va ANTES de multer a propósito: multer escribe el archivo
// en disco mientras procesa la petición, así que rechazar dentro del controlador
// llegaba tarde —el archivo ya estaba guardado— y en la demo, que es pública,
// cualquiera podía seguir llenando el disco con subidas que no se aplicaban.
router.post('/logo', bloquearPruebaGlobal, bloquearLogoEnDemo, upload.single('logo'), uploadLogo);

export default router;
