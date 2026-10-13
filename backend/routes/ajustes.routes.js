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
// bloquearLogoEnDemo va ANTES de multer, que escribe el archivo al procesar.
router.post('/logo', bloquearPruebaGlobal, bloquearLogoEnDemo, upload.single('logo'), uploadLogo);

export default router;
