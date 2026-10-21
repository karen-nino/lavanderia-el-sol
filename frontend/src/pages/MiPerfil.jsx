import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { ES_DEMO } from '../lib/entorno';

const INPUT_CLS =
  'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition';
const MOBILE_INPUT_CLS =
  'w-full px-4 py-3.5 border border-grey/30 rounded-lg text-base text-dark-blue placeholder-grey/60 focus:outline-none focus:border-blue transition';

/** Campos de solo lectura: no se tocan, así no aparece el cursor ni el borde azul. */
const SIN_FOCO = 'pointer-events-none select-none';

const IconoVolver = (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
);

const IconoOjo = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);
const IconoOjoTachado = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88" />
  </svg>
);

/**
 * Mi Perfil del empleado (Ajustes → Mi Perfil): igual al del admin, pero el
 * nombre y el apellido son de solo lectura (los cambia un admin); solo la
 * contraseña se cambia.
 */
export default function MiPerfil() {
  const { usuario } = useAuth();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState(null);

  /* Las cuentas de prueba son compartidas: su contraseña no se cambia. */
  const soloConsultaPruebas = usuario?.es_prueba === true && !ES_DEMO;

  const handlePassword = (e) => {
    if (password === '' && e.target.value.length > 0) setShowPassword(true);
    setPassword(e.target.value);
  };

  const handleGuardar = async (e) => {
    e.preventDefault();
    if (!password) return;
    if (password.length < 6) return setError('La contraseña debe tener al menos 6 caracteres.');
    setSaving(true);
    setError(null);
    try {
      await api.patch('/auth/me', { password });
      setPassword('');
      setShowPassword(false);
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2200);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const botonDeshabilitado = saving || guardado || !password;

  const contenidoBoton = saving ? (
    <>
      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
      Guardando...
    </>
  ) : guardado ? (
    <>
      <svg className="w-5 h-5 animate-pop-in" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"
          style={{ strokeDasharray: 48, strokeDashoffset: 48 }} className="animate-draw-check" />
      </svg>
      ¡Guardado!
    </>
  ) : 'Guardar';

  const avisoPruebas = soloConsultaPruebas && (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-4">
      <p className="font-semibold">Solo de consulta</p>
      <p className="mt-1 text-amber-700">Las cuentas de prueba son compartidas, así que su perfil no se cambia.</p>
    </div>
  );

  const errorModal = error && (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-modal overflow-y-auto p-8 text-center space-y-5 animate-shake">
        <div className="w-20 h-20 mx-auto rounded-full bg-red-100 flex items-center justify-center animate-pop-in">
          <svg className="w-12 h-12 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M6 6L18 18M18 6L6 18"
              style={{ strokeDasharray: 40, strokeDashoffset: 40 }}
              className="animate-draw-x"
            />
          </svg>
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-gray-900">Ocurrió un error</h3>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
        <button
          type="button"
          onClick={() => setError(null)}
          className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
        >
          Cerrar
        </button>
      </div>
    </div>
  );

  return (
    <>
      {errorModal}

      {/* ── Vista móvil ── */}
      <form onSubmit={handleGuardar} className="md:hidden min-h-full bg-gray-50">
        <div className="bg-white border-b-2 border-gray-200">
          <div className="max-w-movil mx-auto px-6 pt-10 pb-4 flex items-center gap-2">
            <Link
              to="/ajustes"
              aria-label="Volver"
              className="w-11 h-11 rounded-pill border border-grey/40 text-dark-blue flex items-center justify-center flex-shrink-0 transition duration-200 ease-out active:scale-[1.3] active:bg-white active:shadow-md"
            >
              {IconoVolver}
            </Link>
            <div>
              <h1 className="text-xl font-bold text-dark-blue leading-tight">Mi Perfil</h1>
              <p className="text-sm text-grey">Información de perfil</p>
            </div>
          </div>
        </div>

        <div className="max-w-movil mx-auto px-6 py-6 space-y-6">
          {avisoPruebas}
          <div className="space-y-5">
            <CampoMovil label="Nombre">
              <input type="text" readOnly tabIndex={-1} value={usuario?.nombre ?? ''} className={`${MOBILE_INPUT_CLS} bg-light-blue/20 text-grey ${SIN_FOCO}`} />
            </CampoMovil>
            <CampoMovil label="Apellido">
              <input type="text" readOnly tabIndex={-1} value={usuario?.apellido ?? ''} className={`${MOBILE_INPUT_CLS} bg-light-blue/20 text-grey ${SIN_FOCO}`} />
            </CampoMovil>
            {!soloConsultaPruebas && (
              <CampoMovil label="Contraseña">
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={handlePassword}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className={`${MOBILE_INPUT_CLS} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-grey hover:text-dark-blue"
                  >
                    {showPassword ? IconoOjoTachado : IconoOjo}
                  </button>
                </div>
              </CampoMovil>
            )}
          </div>

          {!soloConsultaPruebas && (
            <div className="pt-8">
              <button
                type="submit"
                disabled={botonDeshabilitado}
                className={`w-full ${guardado ? 'bg-green-600' : 'bg-blue hover:opacity-90'} ${!password && !guardado ? 'disabled:opacity-50' : 'disabled:opacity-100'} text-white font-medium py-3.5 rounded-lg text-base transition-colors flex items-center justify-center gap-2`}
              >
                {contenidoBoton}
              </button>
            </div>
          )}
        </div>
      </form>

      {/* ── Vista escritorio ── */}
      <form onSubmit={handleGuardar} className="hidden md:block min-h-full bg-gray-50">
        <div className="bg-white border-b-2 border-gray-200">
          <div className="max-w-3xl mx-auto px-8 pt-14 pb-4 flex items-center gap-3">
            <Link
              to="/ajustes"
              aria-label="Volver a Ajustes"
              className="w-11 h-11 rounded-full border border-gray-300 text-dark-blue flex items-center justify-center flex-shrink-0 hover:bg-gray-50 transition-colors"
            >
              {IconoVolver}
            </Link>
            <div className="min-w-0">
              <p className="text-sm text-gray-400">
                <Link to="/ajustes" className="hover:text-blue">Ajustes</Link>{' / '}Cuenta
              </p>
              <h1 className="text-xl font-bold text-gray-900 truncate">Mi Perfil</h1>
            </div>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-8 py-6 space-y-6">
          {avisoPruebas}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-dark-blue">Mi Perfil</h2>
            </div>
            <div className="px-5 py-5 space-y-4">
              <Campo label="Nombre">
                <input type="text" readOnly tabIndex={-1} value={usuario?.nombre ?? ''} className={`${INPUT_CLS} bg-gray-50 text-gray-500 ${SIN_FOCO}`} />
              </Campo>
              <Campo label="Apellido">
                <input type="text" readOnly tabIndex={-1} value={usuario?.apellido ?? ''} className={`${INPUT_CLS} bg-gray-50 text-gray-500 ${SIN_FOCO}`} />
              </Campo>
              {!soloConsultaPruebas && (
                <Campo label="Contraseña">
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={handlePassword}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      className={`${INPUT_CLS} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(s => !s)}
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? IconoOjoTachado : IconoOjo}
                    </button>
                  </div>
                </Campo>
              )}
            </div>
          </div>

          {!soloConsultaPruebas && (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={botonDeshabilitado}
                className={`${guardado ? 'bg-green-600' : 'bg-blue hover:opacity-90'} ${!password && !guardado ? 'disabled:opacity-50' : 'disabled:opacity-100'} text-white font-medium px-8 py-3.5 rounded-lg text-base transition-colors flex items-center justify-center gap-2`}
              >
                {contenidoBoton}
              </button>
            </div>
          )}
        </div>
      </form>
    </>
  );
}

/** Campo con etiqueta, como los de Ajustes en escritorio. */
function Campo({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

/** Campo con etiqueta, como los de Ajustes en celular. */
function CampoMovil({ label, children }) {
  return (
    <div className="space-y-2">
      <label className="block text-base font-bold text-dark-blue">{label}</label>
      {children}
    </div>
  );
}
