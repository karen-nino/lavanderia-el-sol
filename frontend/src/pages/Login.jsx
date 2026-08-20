import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

const INPUT_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition';

export default function Login() {
  const [query, setQuery]               = useState('');
  const [sugerencias, setSugerencias]   = useState([]);
  const [seleccionado, setSeleccionado] = useState(null);
  const [mostrarLista, setMostrarLista] = useState(false);
  const [buscando, setBuscando]         = useState(false);
  const [password, setPassword]         = useState('');
  const [verPassword, setVerPassword]   = useState(false);
  const [error, setError]               = useState('');
  // Motivo por el que se cerró la sesión anterior (lo deja api.js al recibir un
  // 401, p. ej. tras iniciar sesión en otro dispositivo). Se lee una sola vez al
  // montar; el efecto solo lo borra de sessionStorage para que no reaparezca.
  const [aviso, setAviso]               = useState(() => sessionStorage.getItem('authAviso') || '');
  const [loading, setLoading]           = useState(false);

  useEffect(() => {
    if (aviso) sessionStorage.removeItem('authAviso');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { login } = useAuth();
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const passwordRef  = useRef(null);

  // Debounce de la búsqueda de sugerencias
  useEffect(() => {
    if (seleccionado) return;
    const q = query.trim();

    const t = setTimeout(async () => {
      if (!q) { setSugerencias([]); return; }
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
    setAviso('');
    setLoading(true);
    try {
      const data = await api.post('/auth/login', {
        usuario_id: seleccionado.id,
        password,
      }, { skipAuthRedirect: true });
      login(data.token, data.usuario);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Error al iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 to-dark-blue flex items-center justify-center p-4">
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

          {aviso && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2.5 mb-4">
              {aviso}
            </div>
          )}

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
                  className="absolute right-2 top-11 text-xs text-blue hover:text-blue-700 font-medium px-2 py-1"
                >
                  Cambiar
                </button>
              )}

              {mostrarLista && !seleccionado && query.trim() && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {buscando ? (
                    <div className="px-4 py-3.5 text-base text-gray-400">Buscando...</div>
                  ) : sugerencias.length === 0 ? (
                    <div className="px-4 py-3.5 text-base text-gray-400">Sin coincidencias</div>
                  ) : (
                    sugerencias.map(u => (
                      <button
                        type="button"
                        key={u.id}
                        onClick={() => elegirUsuario(u)}
                        className="w-full text-left px-4 py-3.5 text-base text-gray-700 hover:bg-light-blue hover:text-blue-700 transition-colors"
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
              <div className="relative">
                <input
                  ref={passwordRef}
                  type={verPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  disabled={!seleccionado}
                  className={`${INPUT_CLS} pr-11 disabled:bg-gray-50 disabled:cursor-not-allowed ${
                    error ? 'border-red-400 focus:ring-red-400' : ''
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setVerPassword(v => !v)}
                  disabled={!seleccionado}
                  aria-label={verPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 disabled:opacity-40 p-1"
                >
                  {verPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-300 text-red-700 text-sm font-medium rounded-lg px-3 py-2.5">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !seleccionado}
              className="w-full bg-blue hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-3.5 rounded-lg text-base transition-colors mt-2"
            >
              {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
