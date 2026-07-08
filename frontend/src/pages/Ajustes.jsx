import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatTelefono } from '../lib/telefono';
import { useAuth } from '../context/AuthContext';
import { esAdminMain as esAdminMainFn } from '../lib/roles';

const INPUT_CLS =
  'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition';

const MOBILE_INPUT_CLS =
  'w-full px-4 py-3.5 border border-grey/30 rounded-lg text-base text-dark-blue placeholder-grey/60 focus:outline-none focus:border-blue transition';

const ROL_LABEL = { admin_main: 'Admin Main', admin: 'Admin', operador: 'Empleado' };

const SectionIcon = {
  perfil: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  negocio: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 9l1.5-4.5h15L21 9M3 9v10a1 1 0 001 1h16a1 1 0 001-1V9M3 9h18M9 14h6v6H9z" />
    </svg>
  ),
  precios: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 8c-2 0-3 1-3 2.5S10 13 12 13s3 1 3 2.5S14 18 12 18m0-10V6m0 12v2m0-12c1.5 0 2.7.7 3 2" />
    </svg>
  ),
  alertas: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
  gear: (
    <svg className="w-7 h-7 text-grey" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  back: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 19l-7-7 7-7" />
    </svg>
  ),
  imagePlaceholder: (
    <svg className="w-8 h-8 text-grey/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  eye: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ),
  eyeOff: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88" />
    </svg>
  ),
};

const MOBILE_SECTIONS = [
  { id: 'perfil',  label: 'Mi Perfil',                 subtitle: 'Información de perfil',    icon: SectionIcon.perfil  },
  { id: 'negocio', label: 'Sucursales',                subtitle: 'Información de sucursales', icon: SectionIcon.negocio },
  { id: 'maquinas', label: 'Máquinas',                  subtitle: 'Detalles de máquinas',      icon: SectionIcon.precios },
  { id: 'alertas', label: 'Alertas y Notificaciones',  subtitle: 'Ajustes de alertas', icon: SectionIcon.alertas },
];

function Section({ titulo, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-800">{titulo}</h2>
      </div>
      <div className="px-5 py-5 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function MobileField({ label, children, hint }) {
  return (
    <div className="space-y-2">
      <label className="block text-base font-bold text-dark-blue">{label}</label>
      {children}
      {hint && <p className="text-xs text-grey">{hint}</p>}
    </div>
  );
}

function MobileSectionButton({ label, icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-5 bg-white rounded-card text-left shadow-sm"
    >
      <span className="text-blue flex items-center justify-center flex-shrink-0">{icon}</span>
      <span className="text-base font-medium text-dark-blue">{label}</span>
    </button>
  );
}

export default function Ajustes() {
  const { usuario, updateUsuario, sucursalActiva } = useAuth();
  const [config,        setConfig]        = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoPreview,   setLogoPreview]   = useState(null);
  const [mensaje,       setMensaje]       = useState(null);
  const [mobileSection, setMobileSection] = useState(null);
  const [perfilForm,    setPerfilForm]    = useState(() => {
    const [nombre = '', ...resto] = (usuario?.nombre ?? '').split(' ');
    return {
      nombre,
      apellido: resto.join(' '),
      password: '',
    };
  });
  const [showPassword, setShowPassword] = useState(false);
  const logoInputRef = useRef(null);

  // Sucursales: cada una con su nombre, dirección y teléfono editables.
  // sucursalSel = slug de la sucursal que se está editando en el selector.
  const [sucursales,     setSucursales]     = useState([]);
  const [sucursalSel,    setSucursalSel]    = useState('');
  const [savingSucursal, setSavingSucursal] = useState(null); // slug guardándose
  const [cambiandoActiva, setCambiandoActiva] = useState(null); // slug activándose/desactivándose
  const [agregando,      setAgregando]      = useState(false);
  const [creando,        setCreando]        = useState(false);
  const [nuevaSucursal,  setNuevaSucursal]  = useState({ nombre: '', direccion: '', telefono: '' });
  const [confirmarDesactivar, setConfirmarDesactivar] = useState(null); // sucursal a desactivar

  // Solo el Admin Main puede desactivar/reactivar sucursales.
  const esMain = esAdminMainFn(usuario?.rol);

  useEffect(() => {
    api.get('/ajustes')
      .then(data => {
        setConfig({ ...data, telefono: formatTelefono(data.telefono ?? '') });
        if (data.logo_url) setLogoPreview(data.logo_url);
      })
      .catch(e => setMensaje({ tipo: 'error', texto: e.message }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // ?todas=1 incluye inactivas para poder gestionarlas (reactivarlas).
    api.get('/sucursales?todas=1')
      .then(data => {
        const lista = (data ?? []).map(s => ({ ...s, telefono: formatTelefono(s.telefono ?? '') }));
        setSucursales(lista);
        // Arranca en la sucursal activa del admin, o en la primera.
        setSucursalSel(prev => prev || sucursalActiva || lista[0]?.slug || '');
      })
      .catch(() => {});
  }, [sucursalActiva]);

  const handleSucursalChange = (slug, field, value) => {
    const next = field === 'telefono' ? formatTelefono(value) : value;
    setSucursales(prev => prev.map(s => s.slug === slug ? { ...s, [field]: next } : s));
  };

  const guardarSucursal = async (slug) => {
    const s = sucursales.find(x => x.slug === slug);
    if (!s) return;
    if (!String(s.nombre ?? '').trim()) {
      return setMensaje({ tipo: 'error', texto: 'El nombre de la sucursal no puede estar vacío.' });
    }
    setSavingSucursal(slug);
    setMensaje(null);
    try {
      const updated = await api.patch(`/sucursales/${slug}`, {
        nombre:    s.nombre,
        direccion: s.direccion ?? '',
        telefono:  s.telefono  ?? '',
      });
      setSucursales(prev => prev.map(x =>
        x.slug === slug ? { ...updated, telefono: formatTelefono(updated.telefono ?? '') } : x
      ));
      setMensaje({ tipo: 'ok', texto: `Sucursal "${updated.nombre}" actualizada.` });
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setSavingSucursal(null);
    }
  };

  const handleNuevaChange = (field, value) => {
    const next = field === 'telefono' ? formatTelefono(value) : value;
    setNuevaSucursal(prev => ({ ...prev, [field]: next }));
  };

  const agregarSucursal = async () => {
    if (!nuevaSucursal.nombre.trim()) {
      return setMensaje({ tipo: 'error', texto: 'El nombre de la sucursal es requerido.' });
    }
    setCreando(true);
    setMensaje(null);
    try {
      const creada = await api.post('/sucursales', {
        nombre:    nuevaSucursal.nombre.trim(),
        direccion: nuevaSucursal.direccion || '',
        telefono:  nuevaSucursal.telefono  || '',
      });
      const conFormato = { ...creada, telefono: formatTelefono(creada.telefono ?? '') };
      setSucursales(prev => [...prev, conFormato]);
      setSucursalSel(creada.slug);       // pasa a editar la recién creada
      setNuevaSucursal({ nombre: '', direccion: '', telefono: '' });
      setAgregando(false);
      setMensaje({ tipo: 'ok', texto: `Sucursal "${creada.nombre}" creada.` });
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setCreando(false);
    }
  };

  const toggleActivaSucursal = async (slug, activa) => {
    setCambiandoActiva(slug);
    setMensaje(null);
    try {
      const updated = await api.patch(`/sucursales/${slug}/activa`, { activa });
      setSucursales(prev => prev.map(x =>
        x.slug === slug ? { ...x, ...updated, telefono: formatTelefono(updated.telefono ?? '') } : x
      ));
      setMensaje({
        tipo: 'ok',
        texto: `Sucursal "${updated.nombre}" ${activa ? 'reactivada' : 'desactivada'}.`,
      });
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setCambiandoActiva(null);
    }
  };

  const confirmarDesactivarSucursal = async () => {
    if (!confirmarDesactivar) return;
    await toggleActivaSucursal(confirmarDesactivar.slug, false);
    setConfirmarDesactivar(null);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    const next = name === 'telefono' ? formatTelefono(value) : value;
    setConfig(prev => ({ ...prev, [name]: next }));
  };

  const handlePerfilChange = (e) => {
    const { name, value } = e.target;
    if (name === 'password' && perfilForm.password === '' && value.length > 0) {
      setShowPassword(true);
    }
    const next = name === 'telefono' ? formatTelefono(value) : value;
    setPerfilForm(prev => ({ ...prev, [name]: next }));
  };

  const handleGuardarPerfil = async (e) => {
    e.preventDefault();
    const nombreCompleto = `${perfilForm.nombre} ${perfilForm.apellido}`.trim();
    if (!nombreCompleto) {
      return setMensaje({ tipo: 'error', texto: 'El nombre no puede estar vacío.' });
    }
    if (perfilForm.password && perfilForm.password.length < 6) {
      return setMensaje({ tipo: 'error', texto: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    setSaving(true);
    setMensaje(null);
    try {
      const payload = { nombre: nombreCompleto };
      if (perfilForm.password) payload.password = perfilForm.password;
      const updated = await api.patch('/auth/me', payload);
      updateUsuario({
        nombre: updated.nombre,
        rol: updated.rol,
      });
      setPerfilForm(f => ({ ...f, password: '' }));
      setMensaje({ tipo: 'ok', texto: 'Perfil actualizado.' });
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitMobile = (e) => {
    if (mobileSection === 'perfil') return handleGuardarPerfil(e);
    return handleGuardar(e);
  };

  const handleGuardarTodo = async () => {
    const nombreCompleto = `${perfilForm.nombre} ${perfilForm.apellido}`.trim();
    if (!nombreCompleto) {
      return setMensaje({ tipo: 'error', texto: 'El nombre no puede estar vacío.' });
    }
    if (perfilForm.password && perfilForm.password.length < 6) {
      return setMensaje({ tipo: 'error', texto: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    setSaving(true);
    setMensaje(null);
    try {
      const perfilPayload = { nombre: nombreCompleto };
      if (perfilForm.password) perfilPayload.password = perfilForm.password;

      const [updatedPerfil, updatedConfig] = await Promise.all([
        api.patch('/auth/me', perfilPayload),
        api.patch('/ajustes', {
          precio_carga_mediana:  Number(config.precio_carga_mediana),
          precio_carga_jumbo:    Number(config.precio_carga_jumbo),
          precio_carga_secadora: Number(config.precio_carga_secadora),
          precio_edredon_jumbo:  Number(config.precio_edredon_jumbo),
          tiempo_carga_mediana:  Number(config.tiempo_carga_mediana),
          tiempo_carga_jumbo:    Number(config.tiempo_carga_jumbo),
          tiempo_carga_secadora: Number(config.tiempo_carga_secadora),
          nombre_negocio:        config.nombre_negocio,
          stock_minimo_global:   Number(config.stock_minimo_global),
        }),
      ]);

      updateUsuario({ nombre: updatedPerfil.nombre, rol: updatedPerfil.rol });
      setPerfilForm(f => ({ ...f, password: '' }));
      setConfig(updatedConfig);
      setMensaje({ tipo: 'ok', texto: 'Cambios guardados correctamente.' });
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleGuardar = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setMensaje(null);
    try {
      const updated = await api.patch('/ajustes', {
        precio_carga_mediana:  Number(config.precio_carga_mediana),
        precio_carga_jumbo:    Number(config.precio_carga_jumbo),
        precio_carga_secadora: Number(config.precio_carga_secadora),
        precio_edredon_jumbo:  Number(config.precio_edredon_jumbo),
        tiempo_carga_mediana:  Number(config.tiempo_carga_mediana),
        tiempo_carga_jumbo:    Number(config.tiempo_carga_jumbo),
        tiempo_carga_secadora: Number(config.tiempo_carga_secadora),
        nombre_negocio:        config.nombre_negocio,
        stock_minimo_global:   Number(config.stock_minimo_global),
      });
      setConfig(updated);
      setMensaje({ tipo: 'ok', texto: 'Ajustes guardados correctamente.' });
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target.result);
    reader.readAsDataURL(file);

    setUploadingLogo(true);
    setMensaje(null);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const token = localStorage.getItem('token');
      const res = await fetch('/api/ajustes/logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al subir el logo');
      setConfig(prev => ({ ...prev, logo_url: data.logo_url }));
      setLogoPreview(data.logo_url);
      setMensaje({ tipo: 'ok', texto: 'Logo actualizado.' });
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <div className="w-8 h-8 border-4 border-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!config) return null;

  // Sucursal actualmente seleccionada para editar en el selector.
  const sucursalActual = sucursales.find(s => s.slug === sucursalSel) || null;

  // ── Desktop: secciones tipo card ──
  const seccionPerfilDesktop = (
    <Section titulo="Mi Perfil">
      <Field label="Tipo de Cuenta">
        <input
          type="text"
          readOnly
          value={ROL_LABEL[usuario?.rol] ?? (usuario?.rol ?? '')}
          className={`${INPUT_CLS} bg-gray-50 text-gray-500`}
        />
      </Field>

      <Field label="Nombre">
        <input
          type="text"
          name="nombre"
          value={perfilForm.nombre}
          onChange={handlePerfilChange}
          className={INPUT_CLS}
        />
      </Field>

      <Field label="Apellido">
        <input
          type="text"
          name="apellido"
          value={perfilForm.apellido}
          onChange={handlePerfilChange}
          className={INPUT_CLS}
        />
      </Field>

      <Field label="Contraseña">
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            value={perfilForm.password}
            onChange={handlePerfilChange}
            placeholder="••••••••"
            className={`${INPUT_CLS} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShowPassword(s => !s)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
          >
            {showPassword ? SectionIcon.eyeOff : SectionIcon.eye}
          </button>
        </div>
      </Field>
    </Section>
  );

  const seccionPreciosDesktop = (
    <Section titulo="Máquinas">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Mediana</p>
      <Field label="Precio por carga" hint="Aplica a lavadoras medianas en autoservicio y por encargo.">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 flex-shrink-0">$</span>
          <input
            type="number"
            name="precio_carga_mediana"
            min="0"
            step="0.01"
            required
            value={config.precio_carga_mediana ?? ''}
            onChange={handleChange}
            className={INPUT_CLS}
          />
          <span className="text-sm text-gray-500 flex-shrink-0">MXN</span>
        </div>
      </Field>
      <Field label="Tiempo de carga" hint="Duración de un ciclo de lavado en una máquina mediana.">
        <div className="flex items-center gap-2">
          <input
            type="number"
            name="tiempo_carga_mediana"
            min="1"
            step="1"
            required
            value={config.tiempo_carga_mediana ?? ''}
            onChange={handleChange}
            className={INPUT_CLS}
          />
          <span className="text-sm text-gray-500 flex-shrink-0">min</span>
        </div>
      </Field>

      <div className="border-t border-gray-100" />

      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Jumbo</p>
      <Field label="Precio por carga" hint="Aplica a lavadoras jumbo en autoservicio y por encargo.">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 flex-shrink-0">$</span>
          <input
            type="number"
            name="precio_carga_jumbo"
            min="0"
            step="0.01"
            required
            value={config.precio_carga_jumbo ?? ''}
            onChange={handleChange}
            className={INPUT_CLS}
          />
          <span className="text-sm text-gray-500 flex-shrink-0">MXN</span>
        </div>
      </Field>
      <Field label="Tiempo de carga" hint="Duración de un ciclo de lavado en una máquina jumbo.">
        <div className="flex items-center gap-2">
          <input
            type="number"
            name="tiempo_carga_jumbo"
            min="1"
            step="1"
            required
            value={config.tiempo_carga_jumbo ?? ''}
            onChange={handleChange}
            className={INPUT_CLS}
          />
          <span className="text-sm text-gray-500 flex-shrink-0">min</span>
        </div>
      </Field>

      <div className="border-t border-gray-100" />

      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Secadora</p>
      <Field label="Precio por carga" hint="Aplica al servicio de secado.">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 flex-shrink-0">$</span>
          <input
            type="number"
            name="precio_carga_secadora"
            min="0"
            step="0.01"
            required
            value={config.precio_carga_secadora ?? ''}
            onChange={handleChange}
            className={INPUT_CLS}
          />
          <span className="text-sm text-gray-500 flex-shrink-0">MXN</span>
        </div>
      </Field>
      <Field label="Tiempo de carga" hint="Duración de un ciclo de secado.">
        <div className="flex items-center gap-2">
          <input
            type="number"
            name="tiempo_carga_secadora"
            min="1"
            step="1"
            required
            value={config.tiempo_carga_secadora ?? ''}
            onChange={handleChange}
            className={INPUT_CLS}
          />
          <span className="text-sm text-gray-500 flex-shrink-0">min</span>
        </div>
      </Field>

      <div className="border-t border-gray-100" />

      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Edredón (Jumbo)</p>
      <Field label="Precio por carga" hint="Tarifa fija por edredón lavado en máquina jumbo.">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 flex-shrink-0">$</span>
          <input
            type="number"
            name="precio_edredon_jumbo"
            min="0"
            step="0.01"
            required
            value={config.precio_edredon_jumbo ?? ''}
            onChange={handleChange}
            className={INPUT_CLS}
          />
          <span className="text-sm text-gray-500 flex-shrink-0">MXN</span>
        </div>
      </Field>
    </Section>
  );

  const seccionSucursalesDesktop = (
    <Section titulo="Información de sucursales">
      {/* Datos globales del negocio (marca compartida) */}
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Negocio (global)</p>
      <Field label="Nombre del negocio">
        <input
          type="text"
          name="nombre_negocio"
          required
          value={config.nombre_negocio ?? ''}
          onChange={handleChange}
          className={INPUT_CLS}
        />
      </Field>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Logo</label>
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
            {logoPreview ? (
              <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              SectionIcon.imagePlaceholder
            )}
          </div>
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={uploadingLogo}
              className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60 transition-colors"
            >
              {uploadingLogo ? (
                <>
                  <div className="w-4 h-4 border-2 border-blue border-t-transparent rounded-full animate-spin" />
                  Subiendo...
                </>
              ) : (
                'Cambiar logo'
              )}
            </button>
            <p className="text-xs text-gray-400">JPG, PNG o WebP · Máx. 2 MB</p>
          </div>
        </div>
      </div>

      {/* Gestión de sucursales */}
      <div className="border-t border-gray-100 pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sucursales</p>
          <button
            type="button"
            onClick={() => { setAgregando(a => !a); setMensaje(null); }}
            className="text-sm font-medium text-blue hover:opacity-80"
          >
            {agregando ? 'Cancelar' : '+ Agregar sucursal'}
          </button>
        </div>

        {agregando && (
          <div className="rounded-lg border border-blue/30 bg-light-blue/20 p-4 space-y-3">
            <Field label="Nombre de la nueva sucursal">
              <input
                type="text"
                value={nuevaSucursal.nombre}
                onChange={(e) => handleNuevaChange('nombre', e.target.value)}
                placeholder="Ej. Sucursal Centro"
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Dirección">
              <input
                type="text"
                value={nuevaSucursal.direccion}
                onChange={(e) => handleNuevaChange('direccion', e.target.value)}
                placeholder="Calle, número, colonia..."
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Teléfono">
              <input
                type="tel"
                value={nuevaSucursal.telefono}
                onChange={(e) => handleNuevaChange('telefono', e.target.value)}
                inputMode="numeric"
                autoComplete="tel"
                maxLength={12}
                placeholder="33-1234-5678"
                className={INPUT_CLS}
              />
            </Field>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={agregarSucursal}
                disabled={creando}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {creando ? 'Creando...' : 'Crear sucursal'}
              </button>
            </div>
          </div>
        )}

        <Field label="Sucursal a editar">
          <select
            value={sucursalSel}
            onChange={(e) => setSucursalSel(e.target.value)}
            className={`${INPUT_CLS} bg-white`}
          >
            {sucursales.map((s) => (
              <option key={s.slug} value={s.slug}>{s.nombre}{s.activa ? '' : ' (inactiva)'}</option>
            ))}
          </select>
        </Field>

        {sucursalActual && (
          <>
            <Field label="Nombre de la sucursal">
              <input
                type="text"
                value={sucursalActual.nombre ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'nombre', e.target.value)}
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Dirección">
              <input
                type="text"
                value={sucursalActual.direccion ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'direccion', e.target.value)}
                placeholder="Calle, número, colonia..."
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Teléfono">
              <input
                type="tel"
                value={sucursalActual.telefono ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'telefono', e.target.value)}
                inputMode="numeric"
                autoComplete="tel"
                maxLength={12}
                placeholder="33-1234-5678"
                className={INPUT_CLS}
              />
            </Field>
            <div className="flex items-center justify-between pt-1">
              {esMain ? (
                <button
                  type="button"
                  onClick={() => sucursalActual.activa
                    ? setConfirmarDesactivar(sucursalActual)
                    : toggleActivaSucursal(sucursalActual.slug, true)}
                  disabled={cambiandoActiva === sucursalActual.slug}
                  className={`text-sm font-medium disabled:opacity-60 ${
                    sucursalActual.activa ? 'text-red hover:opacity-80' : 'text-green hover:opacity-80'
                  }`}
                >
                  {cambiandoActiva === sucursalActual.slug
                    ? 'Aplicando...'
                    : sucursalActual.activa ? 'Desactivar sucursal' : 'Reactivar sucursal'}
                </button>
              ) : <span />}
              <button
                type="button"
                onClick={() => guardarSucursal(sucursalActual.slug)}
                disabled={savingSucursal === sucursalActual.slug}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {savingSucursal === sucursalActual.slug ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Guardando...
                  </>
                ) : (
                  'Guardar sucursal'
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </Section>
  );

  const seccionAlertasDesktop = (
    <Section titulo="Alertas de inventario">
      <Field
        label="Unidades mínimas para alerta de stock bajo"
        hint="Los productos con stock igual o menor a este número se marcarán como 'Por agotarse'"
      >
        <input
          type="number"
          name="stock_minimo_global"
          min="0"
          step="1"
          required
          value={config.stock_minimo_global ?? ''}
          onChange={handleChange}
          className={INPUT_CLS}
        />
      </Field>
    </Section>
  );

  // ── Mobile: contenido por sección ──
  const seccionPerfilMobile = (
    <div className="space-y-5">
      <MobileField label="Tipo de Cuenta">
        <input
          type="text"
          readOnly
          value={ROL_LABEL[usuario?.rol] ?? (usuario?.rol ?? '')}
          className={`${MOBILE_INPUT_CLS} bg-light-blue/20 text-grey`}
        />
      </MobileField>

      <MobileField label="Nombre">
        <input
          type="text"
          name="nombre"
          value={perfilForm.nombre}
          onChange={handlePerfilChange}
          className={MOBILE_INPUT_CLS}
        />
      </MobileField>

      <MobileField label="Apellido">
        <input
          type="text"
          name="apellido"
          value={perfilForm.apellido}
          onChange={handlePerfilChange}
          className={MOBILE_INPUT_CLS}
        />
      </MobileField>

      <MobileField label="Contraseña">
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            value={perfilForm.password}
            onChange={handlePerfilChange}
            placeholder="••••••••"
            className={`${MOBILE_INPUT_CLS} pr-12`}
          />
          <button
            type="button"
            onClick={() => setShowPassword(s => !s)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-grey hover:text-dark-blue"
          >
            {showPassword ? SectionIcon.eyeOff : SectionIcon.eye}
          </button>
        </div>
      </MobileField>
    </div>
  );

  const seccionSucursalesMobile = (
    <div className="space-y-6">
      {/* Datos globales del negocio (marca compartida) */}
      <div className="space-y-5">
        <p className="text-xs font-semibold text-grey uppercase tracking-wide">Negocio (global)</p>
        <MobileField label="Nombre del Negocio">
          <input
            type="text"
            name="nombre_negocio"
            required
            value={config.nombre_negocio ?? ''}
            onChange={handleChange}
            className={MOBILE_INPUT_CLS}
          />
        </MobileField>

        <MobileField label="Logo">
          <div className="border border-grey/30 rounded-lg p-4 flex items-center gap-4">
            <div className="w-20 h-20 rounded-lg border-2 border-dashed border-grey/40 bg-light-blue/20 flex items-center justify-center overflow-hidden flex-shrink-0">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                SectionIcon.imagePlaceholder
              )}
            </div>
            <div className="flex-1 space-y-2">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploadingLogo}
                className="px-4 py-2 border border-grey/40 rounded-lg text-sm text-dark-blue bg-white disabled:opacity-60"
              >
                {uploadingLogo ? 'Subiendo...' : 'Cambiar logo'}
              </button>
              <p className="text-xs text-grey">JPG, PNG o WebP Max. 2 MB</p>
            </div>
          </div>
        </MobileField>
      </div>

      {/* Gestión de sucursales */}
      <div className="space-y-5 border-t border-light-blue/60 pt-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-grey uppercase tracking-wide">Sucursales</p>
          <button
            type="button"
            onClick={() => { setAgregando(a => !a); setMensaje(null); }}
            className="text-sm font-medium text-blue"
          >
            {agregando ? 'Cancelar' : '+ Agregar'}
          </button>
        </div>

        {agregando && (
          <div className="rounded-lg border border-blue/30 bg-light-blue/20 p-4 space-y-4">
            <MobileField label="Nombre de la nueva sucursal">
              <input
                type="text"
                value={nuevaSucursal.nombre}
                onChange={(e) => handleNuevaChange('nombre', e.target.value)}
                placeholder="Ej. Sucursal Centro"
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <MobileField label="Dirección">
              <input
                type="text"
                value={nuevaSucursal.direccion}
                onChange={(e) => handleNuevaChange('direccion', e.target.value)}
                placeholder="Calle, número, colonia..."
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <MobileField label="Teléfono">
              <input
                type="tel"
                value={nuevaSucursal.telefono}
                onChange={(e) => handleNuevaChange('telefono', e.target.value)}
                inputMode="numeric"
                autoComplete="tel"
                maxLength={12}
                placeholder="33-1234-5678"
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <button
              type="button"
              onClick={agregarSucursal}
              disabled={creando}
              className="w-full py-3.5 rounded-lg bg-blue text-white text-base font-medium disabled:opacity-60"
            >
              {creando ? 'Creando...' : 'Crear sucursal'}
            </button>
          </div>
        )}

        <MobileField label="Sucursal a editar">
          <select
            value={sucursalSel}
            onChange={(e) => setSucursalSel(e.target.value)}
            className={`${MOBILE_INPUT_CLS} bg-white`}
          >
            {sucursales.map((s) => (
              <option key={s.slug} value={s.slug}>{s.nombre}{s.activa ? '' : ' (inactiva)'}</option>
            ))}
          </select>
        </MobileField>

        {sucursalActual && (
          <>
            <MobileField label="Nombre de la sucursal">
              <input
                type="text"
                value={sucursalActual.nombre ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'nombre', e.target.value)}
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <MobileField label="Dirección">
              <input
                type="text"
                value={sucursalActual.direccion ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'direccion', e.target.value)}
                placeholder="Calle, número, colonia..."
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <MobileField label="Teléfono">
              <input
                type="tel"
                value={sucursalActual.telefono ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'telefono', e.target.value)}
                inputMode="numeric"
                autoComplete="tel"
                maxLength={12}
                placeholder="33-1234-5678"
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <button
              type="button"
              onClick={() => guardarSucursal(sucursalActual.slug)}
              disabled={savingSucursal === sucursalActual.slug}
              className="w-full py-3.5 rounded-lg bg-blue text-white text-base font-medium disabled:opacity-60"
            >
              {savingSucursal === sucursalActual.slug ? 'Guardando...' : 'Guardar sucursal'}
            </button>
            {esMain && (
              <button
                type="button"
                onClick={() => sucursalActual.activa
                  ? setConfirmarDesactivar(sucursalActual)
                  : toggleActivaSucursal(sucursalActual.slug, true)}
                disabled={cambiandoActiva === sucursalActual.slug}
                className={`w-full py-3.5 rounded-lg text-base font-medium border disabled:opacity-60 ${
                  sucursalActual.activa
                    ? 'border-red/40 text-red'
                    : 'border-green/40 text-green'
                }`}
              >
                {cambiandoActiva === sucursalActual.slug
                  ? 'Aplicando...'
                  : sucursalActual.activa ? 'Desactivar sucursal' : 'Reactivar sucursal'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );

  const seccionPreciosMobile = (
    <div className="space-y-6">
      <div className="space-y-5">
        <p className="text-xs font-semibold text-grey uppercase tracking-wide">Mediana</p>
        <MobileField label="Precio por carga" hint="Aplica a lavadoras medianas (autoservicio y por encargo).">
          <div className="flex items-center gap-2">
            <span className="text-base text-grey flex-shrink-0">$</span>
            <input
              type="number"
              name="precio_carga_mediana"
              min="0"
              step="0.01"
              required
              value={config.precio_carga_mediana ?? ''}
              onChange={handleChange}
              className={MOBILE_INPUT_CLS}
            />
            <span className="text-base text-grey flex-shrink-0">MXN</span>
          </div>
        </MobileField>
        <MobileField label="Tiempo de carga" hint="Duración del ciclo de lavado en una máquina mediana.">
          <div className="flex items-center gap-2">
            <input
              type="number"
              name="tiempo_carga_mediana"
              min="1"
              step="1"
              required
              value={config.tiempo_carga_mediana ?? ''}
              onChange={handleChange}
              className={MOBILE_INPUT_CLS}
            />
            <span className="text-base text-grey flex-shrink-0">min</span>
          </div>
        </MobileField>
      </div>

      <div className="border-t border-light-blue/60" />

      <div className="space-y-5">
        <p className="text-xs font-semibold text-grey uppercase tracking-wide">Jumbo</p>
        <MobileField label="Precio por carga" hint="Aplica a lavadoras jumbo (autoservicio y por encargo).">
          <div className="flex items-center gap-2">
            <span className="text-base text-grey flex-shrink-0">$</span>
            <input
              type="number"
              name="precio_carga_jumbo"
              min="0"
              step="0.01"
              required
              value={config.precio_carga_jumbo ?? ''}
              onChange={handleChange}
              className={MOBILE_INPUT_CLS}
            />
            <span className="text-base text-grey flex-shrink-0">MXN</span>
          </div>
        </MobileField>
        <MobileField label="Tiempo de carga" hint="Duración del ciclo de lavado en una máquina jumbo.">
          <div className="flex items-center gap-2">
            <input
              type="number"
              name="tiempo_carga_jumbo"
              min="1"
              step="1"
              required
              value={config.tiempo_carga_jumbo ?? ''}
              onChange={handleChange}
              className={MOBILE_INPUT_CLS}
            />
            <span className="text-base text-grey flex-shrink-0">min</span>
          </div>
        </MobileField>
      </div>

      <div className="border-t border-light-blue/60" />

      <div className="space-y-5">
        <p className="text-xs font-semibold text-grey uppercase tracking-wide">Secadora</p>
        <MobileField label="Precio por carga" hint="Aplica al servicio de secado.">
          <div className="flex items-center gap-2">
            <span className="text-base text-grey flex-shrink-0">$</span>
            <input
              type="number"
              name="precio_carga_secadora"
              min="0"
              step="0.01"
              required
              value={config.precio_carga_secadora ?? ''}
              onChange={handleChange}
              className={MOBILE_INPUT_CLS}
            />
            <span className="text-base text-grey flex-shrink-0">MXN</span>
          </div>
        </MobileField>
        <MobileField label="Tiempo de carga" hint="Duración del ciclo de secado.">
          <div className="flex items-center gap-2">
            <input
              type="number"
              name="tiempo_carga_secadora"
              min="1"
              step="1"
              required
              value={config.tiempo_carga_secadora ?? ''}
              onChange={handleChange}
              className={MOBILE_INPUT_CLS}
            />
            <span className="text-base text-grey flex-shrink-0">min</span>
          </div>
        </MobileField>
      </div>

      <div className="border-t border-light-blue/60" />

      <div className="space-y-5">
        <p className="text-xs font-semibold text-grey uppercase tracking-wide">Edredón (Jumbo)</p>
        <MobileField label="Precio por carga" hint="Tarifa fija por edredón lavado en máquina jumbo.">
          <div className="flex items-center gap-2">
            <span className="text-base text-grey flex-shrink-0">$</span>
            <input
              type="number"
              name="precio_edredon_jumbo"
              min="0"
              step="0.01"
              required
              value={config.precio_edredon_jumbo ?? ''}
              onChange={handleChange}
              className={MOBILE_INPUT_CLS}
            />
            <span className="text-base text-grey flex-shrink-0">MXN</span>
          </div>
        </MobileField>
      </div>
    </div>
  );

  const seccionAlertasMobile = (
    <MobileField
      label="Unidades mínimas para alerta de stock bajo"
      hint="Los productos con stock igual o menor a este número se marcarán como 'Por agotarse'"
    >
      <input
        type="number"
        name="stock_minimo_global"
        min="0"
        step="1"
        required
        value={config.stock_minimo_global ?? ''}
        onChange={handleChange}
        className={MOBILE_INPUT_CLS}
      />
    </MobileField>
  );

  const mobileSectionContent = {
    perfil:  seccionPerfilMobile,
    negocio: seccionSucursalesMobile,
    maquinas: seccionPreciosMobile,
    alertas: seccionAlertasMobile,
  };

  const mensajeBanner = mensaje && (
    <div className={`rounded-lg px-4 py-3 text-sm ${
      mensaje.tipo === 'ok'
        ? 'bg-green-50 border border-green-200 text-green-700'
        : 'bg-red-50 border border-red-200 text-red-700'
    }`}>
      {mensaje.texto}
    </div>
  );

  const activeSection = MOBILE_SECTIONS.find((s) => s.id === mobileSection);

  return (
    <>
      {/* ── Vista móvil ── */}
      <div className="md:hidden min-h-full bg-slate-100">
        {!activeSection ? (
          <>
            <div className="bg-white border-b-2 border-gray-200">
              <div className="px-6 pt-10 pb-4 flex flex-col items-start">
                <div className='flex flex-row items-center gap-1'>
                  {SectionIcon.gear}
                  <h1 className="text-xl font-bold text-dark-blue leading-tight">Ajustes</h1>
                </div>
                <p className="text-sm text-grey">Pantalla de ajustes</p>
              </div>
            </div>
            <div className="px-6 py-6 space-y-3">
              {MOBILE_SECTIONS.map((s) => (
                <MobileSectionButton
                  key={s.id}
                  label={s.label}
                  icon={s.icon}
                  onClick={() => setMobileSection(s.id)}
                />
              ))}
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmitMobile}>
            <div className="bg-white border-b-2 border-gray-200">
              <div className="px-6 pt-10 pb-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMobileSection(null)}
                  aria-label="Volver"
                  className="w-11 h-11 rounded-pill border border-grey/40 text-dark-blue flex items-center justify-center flex-shrink-0"
                >
                  {SectionIcon.back}
                </button>
                <div>
                  <h1 className="text-xl font-bold text-dark-blue leading-tight">{activeSection.label}</h1>
                  <p className="text-sm text-grey">{activeSection.subtitle}</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-6 space-y-6">
            {mobileSectionContent[activeSection.id]}

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setMobileSection(null)}
                className="py-4 rounded-lg bg-light-blue/40 text-grey text-base font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="py-4 rounded-lg bg-blue text-white text-base font-medium disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Guardando...
                  </>
                ) : (
                  'Guardar'
                )}
              </button>
            </div>
            {mensajeBanner}
            </div>
          </form>
        )}
      </div>

      <input
        ref={logoInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp"
        onChange={handleLogoSelect}
        className="hidden"
      />

      {/* ── Vista desktop ── */}
      <div className="hidden md:block min-h-full bg-slate-100">
        {/* Cabecera (barra superior) */}
        <div className="bg-white border-b-2 border-gray-200">
          <div className="max-w-2xl mx-auto px-6 pt-14 pb-4">
            <h1 className="text-xl font-bold text-gray-900">Ajustes</h1>
          </div>
        </div>

        {/* Contenido */}
        <div className="max-w-2xl mx-auto p-6 space-y-6">

        <div className="space-y-6">
          {seccionPerfilDesktop}
        </div>

        <div className="space-y-6">
          {seccionPreciosDesktop}
          {seccionSucursalesDesktop}
          {seccionAlertasDesktop}
        </div>

        <div className="space-y-3">
          {mensajeBanner}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleGuardarTodo}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-3.5 bg-blue hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed text-white text-base font-medium rounded-lg transition-colors"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Guardando...
                </>
              ) : (
                'Guardar cambios'
              )}
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Confirmación para desactivar una sucursal (solo Admin Main) */}
      {confirmarDesactivar && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="p-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900 text-center mb-1">Desactivar sucursal</h3>
              <p className="text-sm text-gray-500 text-center mb-4">
                ¿Seguro que quieres desactivar{' '}
                <span className="font-medium text-gray-700">{confirmarDesactivar.nombre}</span>?
                Dejará de aparecer en la operación, pero su historial (notas, caja y ventas) se conserva
                y podrás reactivarla después.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmarDesactivar(null)}
                  className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmarDesactivarSucursal}
                  disabled={cambiandoActiva === confirmarDesactivar.slug}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
                >
                  {cambiandoActiva === confirmarDesactivar.slug ? 'Desactivando...' : 'Desactivar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
