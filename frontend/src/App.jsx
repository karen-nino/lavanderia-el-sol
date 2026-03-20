import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import AdminRoute from './components/AdminRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Ordenes from './pages/Ordenes';
import NuevaOrden from './pages/NuevaOrden';
import Clientes from './pages/Clientes';
import Maquinas from './pages/Maquinas';
import Inventario from './pages/Inventario';
import DetalleOrden from './pages/DetalleOrden';
import Salidas from './pages/Salidas';
import Ventas from './pages/Ventas';
import Configuracion from './pages/Configuracion';

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
                <Layout />
              </PrivateRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="ordenes" element={<Ordenes />} />
            <Route path="ordenes/nueva" element={<NuevaOrden />} />
            <Route path="ordenes/:id" element={<DetalleOrden />} />
            <Route path="ordenes/:id/salidas" element={<Salidas />} />
            <Route path="clientes" element={<Clientes />} />
            <Route path="maquinas" element={<Maquinas />} />
            <Route path="inventario" element={<Inventario />} />
            <Route
              path="ventas"
              element={
                <AdminRoute>
                  <Ventas />
                </AdminRoute>
              }
            />
            <Route
              path="configuracion"
              element={
                <AdminRoute>
                  <Configuracion />
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
