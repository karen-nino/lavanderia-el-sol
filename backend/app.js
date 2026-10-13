import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// Crear carpeta de uploads si no existe
if (!fs.existsSync('./uploads/logo')) {
  fs.mkdirSync('./uploads/logo', { recursive: true });
}

const app = express();

// En Fly hay exactamente un proxy: así req.ip es la IP real (para los límites por IP).
app.set('trust proxy', 1);

// Sin CORS a propósito: el tráfico legítimo llega same-origin (el hosting del
// frontend hace proxy de /api y /uploads; en desarrollo, Vite).
app.use(helmet());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Routes
import authRoutes           from './routes/auth.routes.js';
import usuariosRoutes       from './routes/usuarios.routes.js';
import clientesRoutes       from './routes/clientes.routes.js';
import maquinasRoutes       from './routes/maquinas.routes.js';
import notasRoutes          from './routes/notas.routes.js';
import insumosRoutes        from './routes/insumos.routes.js';
import productosRoutes      from './routes/productos.routes.js';
import ventasRoutes         from './routes/ventas.routes.js';
import cajaRoutes           from './routes/caja.routes.js';
import ajustesRoutes        from './routes/ajustes.routes.js';
import sucursalesRoutes     from './routes/sucursales.routes.js';
import notificacionesRoutes from './routes/notificaciones.routes.js';
import etiquetasRoutes      from './routes/etiquetas.routes.js';
import ewelinkRoutes        from './routes/ewelink.routes.js';

app.use('/api/auth',           authRoutes);
app.use('/api/usuarios',       usuariosRoutes);
app.use('/api/clientes',       clientesRoutes);
app.use('/api/maquinas',       maquinasRoutes);
app.use('/api/notas',          notasRoutes);
app.use('/api/insumos',        insumosRoutes);
app.use('/api/productos',      productosRoutes);
app.use('/api/ventas',         ventasRoutes);
app.use('/api/caja',           cajaRoutes);
app.use('/api/ajustes',        ajustesRoutes);
app.use('/api/sucursales',     sucursalesRoutes);
app.use('/api/notificaciones', notificacionesRoutes);
app.use('/api/etiquetas',      etiquetasRoutes);
app.use('/api/ewelink',        ewelinkRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Lavanderia El Sol API running' });
});

export default app;
