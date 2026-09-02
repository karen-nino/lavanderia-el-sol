import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { bloquearPruebaGlobal } from '../middleware/sucursalActiva.js';
import { getAjustes, updateAjustes, uploadLogo, upload } from '../controllers/ajustes.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/',    getAjustes);
// Los ajustes son del negocio entero (tarifas, tiempos, ticket): los usuarios
// de prueba los leen, pero no los cambian.
router.patch('/',  bloquearPruebaGlobal, updateAjustes);
router.post('/logo', bloquearPruebaGlobal, upload.single('logo'), uploadLogo);

export default router;
