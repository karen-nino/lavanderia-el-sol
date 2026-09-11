import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { bloquearPruebaGlobal } from '../middleware/sucursalActiva.js';
import { tiposTela, tamanosEdredon, marcasProducto, envasesProducto, marcasMaquina, getTiemposMarca, guardarTiempoMarca } from '../controllers/etiquetas.controller.js';

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

// Marcas de máquina (mig. 106): LG, Samsung, Speed Queen. Se eligen de la
// lista al dar de alta la máquina y se amplían desde el mismo formulario.
// El modelo (ej. "FH4U2VHN2") sigue siendo texto libre en la máquina.
router.get('/marcas-maquina',            marcasMaquina.getAll);
router.post('/marcas-maquina',           marcasMaquina.create);
router.patch('/marcas-maquina/reordenar', marcasMaquina.reorder);
router.put('/marcas-maquina/:id',        marcasMaquina.update);

// Tiempos de ciclo por marca y tamaño (mig. 107). No es un catálogo con la
// forma de los de arriba, así que va con sus propios handlers.
router.get('/tiempos-marca', getTiemposMarca);
router.put('/tiempos-marca', guardarTiempoMarca);

export default router;
