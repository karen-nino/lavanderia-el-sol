import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { getAjustes, updateAjustes, uploadLogo, upload } from '../controllers/ajustes.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/',    getAjustes);
router.patch('/',  updateAjustes);
router.post('/logo', upload.single('logo'), uploadLogo);

export default router;
