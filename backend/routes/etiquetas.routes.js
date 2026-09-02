import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { bloquearPruebaGlobal } from '../middleware/sucursalActiva.js';
import { tiposTela, tamanosEdredon, marcasProducto, envasesProducto } from '../controllers/etiquetas.controller.js';

const router = Router();

router.use(verifyToken);

// Los catálogos de etiquetas son del negocio entero (no de una sucursal): los
// usuarios de prueba los consultan, pero no los modifican.
router.use((req, res, next) => (
  req.method === 'GET' ? next() : bloquearPruebaGlobal(req, res, next)
));

// Tipos de tela (para Ropa)
router.get('/tipos-tela',            tiposTela.getAll);
router.post('/tipos-tela',           tiposTela.create);
router.patch('/tipos-tela/reordenar', tiposTela.reorder);
router.put('/tipos-tela/:id',        tiposTela.update);

// Tamaños de edredón
router.get('/tamanos-edredon',            tamanosEdredon.getAll);
router.post('/tamanos-edredon',           tamanosEdredon.create);
router.patch('/tamanos-edredon/reordenar', tamanosEdredon.reorder);
router.put('/tamanos-edredon/:id',        tamanosEdredon.update);

// Marcas de producto (Inventario)
router.get('/marcas-producto',            marcasProducto.getAll);
router.post('/marcas-producto',           marcasProducto.create);
router.patch('/marcas-producto/reordenar', marcasProducto.reorder);
router.put('/marcas-producto/:id',        marcasProducto.update);

// Envases de producto (Inventario)
router.get('/envases-producto',            envasesProducto.getAll);
router.post('/envases-producto',           envasesProducto.create);
router.patch('/envases-producto/reordenar', envasesProducto.reorder);
router.put('/envases-producto/:id',        envasesProducto.update);

export default router;
