import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { getConfiguracion, updateConfiguracion, uploadLogo, upload } from '../controllers/configuracion.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/',    getConfiguracion);
router.patch('/',  updateConfiguracion);
router.post('/logo', upload.single('logo'), uploadLogo);

export default router;
