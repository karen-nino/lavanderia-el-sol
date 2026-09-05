import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthProvider';
import PrivateRoute from './components/PrivateRoute';
import AdminRoute from './components/AdminRoute';
import SucursalGate from './components/SucursalGate';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Notas from './pages/Notas';
import NuevaNota from './pages/NuevaNota';
import Clientes from './pages/Clientes';
import Maquinas from './pages/Maquinas';
import GestionMaquinas from './pages/GestionMaquinas';
import MaquinaUso from './pages/MaquinaUso';
import Inventario from './pages/Inventario';
import Caja from './pages/Caja';
import DetalleNota from './pages/DetalleNota';
import TicketNota from './pages/TicketNota';
import Salidas from './pages/Salidas';
import Ventas from './pages/Ventas';
import Empleados from './pages/Empleados';
import EmpleadoDesempeno from './pages/EmpleadoDesempeno';
import Ajustes from './pages/Ajustes';
import Manual from './pages/Manual';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <SucursalGate>
                  <Layout />
                </SucursalGate>
              </PrivateRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="notas" element={<Notas />} />
            <Route path="notas/nueva" element={<NuevaNota />} />
            <Route path="notas/:id" element={<DetalleNota />} />
            <Route path="notas/:id/ticket" element={<TicketNota />} />
            <Route path="notas/:id/editar" element={<NuevaNota />} />
            <Route path="notas/:id/salidas" element={<Salidas />} />
            <Route path="clientes" element={<Clientes />} />
            <Route path="maquinas" element={<Maquinas />} />
            <Route path="gestion-maquinas" element={<GestionMaquinas />} />
            <Route
              path="gestion-maquinas/:id/uso"
              element={
                <AdminRoute>
                  <MaquinaUso />
                </AdminRoute>
              }
            />
            <Route path="inventario" element={<Inventario />} />
            <Route path="caja" element={<Caja />} />
            <Route
              path="ventas"
              element={
                <AdminRoute>
                  <Ventas />
                </AdminRoute>
              }
            />
            <Route
              path="empleados"
              element={
                <AdminRoute>
                  <Empleados />
                </AdminRoute>
              }
            />
            <Route
              path="empleados/:id/desempeno"
              element={
                <AdminRoute>
                  <EmpleadoDesempeno />
                </AdminRoute>
              }
            />
            <Route
              path="ajustes"
              element={
                <AdminRoute>
                  <Ajustes />
                </AdminRoute>
              }
            />
            {/* El manual se abre en su propia página (desde Ajustes), porque en
                escritorio Ajustes es una sola columna larga y el manual no cabe
                dentro sin estorbar.
                POR AHORA va bajo AdminRoute, como Ajustes: es decisión de la
                clienta mientras revisa que el contenido sea correcto (2026-09-05).
                Cuando lo dé por bueno se abrirá a los empleados, que son su
                público natural — y entonces hay que sacarlo de aquí y darle
                entrada propia en el menú, porque a Ajustes ellos no entran. */}
            <Route
              path="manual"
              element={
                <AdminRoute>
                  <Manual />
                </AdminRoute>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
