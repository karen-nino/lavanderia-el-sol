import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import AdminRoute from './components/AdminRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Notas from './pages/Notas';
import NuevaNota from './pages/NuevaNota';
import Clientes from './pages/Clientes';
import Maquinas from './pages/Maquinas';
import Inventario from './pages/Inventario';
import DetalleNota from './pages/DetalleNota';
import Salidas from './pages/Salidas';
import Ventas from './pages/Ventas';
import Empleados from './pages/Empleados';
import Ajustes from './pages/Ajustes';

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
            <Route path="notas" element={<Notas />} />
            <Route path="notas/nueva" element={<NuevaNota />} />
            <Route path="notas/:id" element={<DetalleNota />} />
            <Route path="notas/:id/editar" element={<NuevaNota />} />
            <Route path="notas/:id/salidas" element={<Salidas />} />
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
              path="empleados"
              element={
                <AdminRoute>
                  <Empleados />
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
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
