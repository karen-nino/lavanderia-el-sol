import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

const INPUT_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition';

export default function Login() {
  const [query, setQuery]               = useState('');
  const [sugerencias, setSugerencias]   = useState([]);
  const [seleccionado, setSeleccionado] = useState(null);
  const [mostrarLista, setMostrarLista] = useState(false);
  const [buscando, setBuscando]         = useState(false);
  const [password, setPassword]         = useState('');
  const [error, setError]               = useState('');
  const [loading, setLoading]           = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const passwordRef  = useRef(null);

  // Debounce de la búsqueda de sugerencias
  useEffect(() => {
    if (seleccionado) return;
    const q = query.trim();
    if (!q) { setSugerencias([]); return; }

    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const data = await api.get(`/auth/buscar-usuarios?q=${encodeURIComponent(q)}`);
        setSugerencias(data ?? []);
        setMostrarLista(true);
      } catch {
        setSugerencias([]);
      } finally {
        setBuscando(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, seleccionado]);

  // Cerrar dropdown al click fuera
  useEffect(() => {
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setMostrarLista(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const elegirUsuario = (u) => {
    setSeleccionado(u);
    setQuery(u.nombre);
    setMostrarLista(false);
    setError('');
    setTimeout(() => passwordRef.current?.focus(), 0);
  };

  const cambiarUsuario = () => {
    setSeleccionado(null);
    setPassword('');
    setQuery('');
    setError('');
  };

  const handleQueryChange = (e) => {
    setQuery(e.target.value);
    if (seleccionado) {
      setSeleccionado(null);
      setPassword('');
    }
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!seleccionado) {
      setError('Selecciona tu nombre de la lista.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const data = await api.post('/auth/login', {
        usuario_id: seleccionado.id,
        password,
      });
      login(data.token, data.usuario);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Error al iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-3 select-none">🫧</div>
          <h1 className="text-2xl font-bold text-white">Lavandería El Sol</h1>
          <p className="text-slate-400 text-sm mt-1">Panel de administración</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-base font-semibold text-gray-800 mb-6">Iniciar sesión</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div ref={containerRef} className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Usuario
              </label>
              <input
                type="text"
                required
                value={query}
                onChange={handleQueryChange}
                onFocus={() => sugerencias.length > 0 && setMostrarLista(true)}
                autoComplete="off"
                placeholder="Escribe tu nombre..."
                className={INPUT_CLS}
              />

              {seleccionado && (
                <button
                  type="button"
                  onClick={cambiarUsuario}
                  className="absolute right-2 top-11 text-xs text-indigo-600 hover:text-indigo-700 font-medium px-2 py-1"
                >
                  Cambiar
                </button>
              )}

              {mostrarLista && !seleccionado && query.trim() && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {buscando ? (
                    <div className="px-3 py-2.5 text-sm text-gray-400">Buscando...</div>
                  ) : sugerencias.length === 0 ? (
                    <div className="px-3 py-2.5 text-sm text-gray-400">Sin coincidencias</div>
                  ) : (
                    sugerencias.map(u => (
                      <button
                        type="button"
                        key={u.id}
                        onClick={() => elegirUsuario(u)}
                        className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                      >
                        {u.nombre}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Contraseña
              </label>
              <input
                ref={passwordRef}
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                disabled={!seleccionado}
                className={`${INPUT_CLS} disabled:bg-gray-50 disabled:cursor-not-allowed`}
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2.5">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !seleccionado}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-3.5 rounded-lg text-base transition-colors mt-2"
            >
              {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
