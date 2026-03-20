import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

const INPUT_CLS =
  'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition';

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

export default function Configuracion() {
  const [config,        setConfig]        = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoPreview,   setLogoPreview]   = useState(null);
  const [mensaje,       setMensaje]       = useState(null); // { tipo: 'ok'|'error', texto }
  const logoInputRef = useRef(null);

  useEffect(() => {
    api.get('/configuracion')
      .then(data => {
        setConfig(data);
        if (data.logo_url) setLogoPreview(data.logo_url);
      })
      .catch(e => setMensaje({ tipo: 'error', texto: e.message }))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setConfig(prev => ({ ...prev, [name]: value }));
  };

  const handleGuardar = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMensaje(null);
    try {
      const updated = await api.patch('/configuracion', {
        precio_autoservicio:  Number(config.precio_autoservicio),
        nombre_negocio:       config.nombre_negocio,
        direccion:            config.direccion ?? '',
        telefono:             config.telefono  ?? '',
        stock_minimo_global:  Number(config.stock_minimo_global),
      });
      setConfig(updated);
      setMensaje({ tipo: 'ok', texto: 'Configuración guardada correctamente.' });
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Preview local inmediato
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target.result);
    reader.readAsDataURL(file);

    setUploadingLogo(true);
    setMensaje(null);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const token = localStorage.getItem('token');
      const res = await fetch('/api/configuracion/logo', {
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
      // Reset input para permitir subir el mismo archivo de nuevo
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Configuración</h1>

      {/* Mensaje de éxito / error */}
      {mensaje && (
        <div className={`rounded-lg px-4 py-3 text-sm ${
          mensaje.tipo === 'ok'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {mensaje.texto}
        </div>
      )}

      <form onSubmit={handleGuardar} className="space-y-6">

        {/* ── Sección 1: Precios base ── */}
        <Section titulo="Precios base de servicios">
          <Field label="Precio por carga — Autoservicio">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 flex-shrink-0">$</span>
              <input
                type="number"
                name="precio_autoservicio"
                min="0"
                step="0.01"
                required
                value={config.precio_autoservicio ?? ''}
                onChange={handleChange}
                className={INPUT_CLS}
              />
              <span className="text-sm text-gray-500 flex-shrink-0">MXN</span>
            </div>
          </Field>
        </Section>

        {/* ── Sección 2: Información de la sucursal ── */}
        <Section titulo="Información de la sucursal">
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

          <Field label="Dirección">
            <input
              type="text"
              name="direccion"
              value={config.direccion ?? ''}
              onChange={handleChange}
              placeholder="Calle, número, colonia..."
              className={INPUT_CLS}
            />
          </Field>

          <Field label="Teléfono">
            <input
              type="text"
              name="telefono"
              value={config.telefono ?? ''}
              onChange={handleChange}
              placeholder="Ej. 33 1234 5678"
              className={INPUT_CLS}
            />
          </Field>

          {/* Logo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Logo</label>
            <div className="flex items-center gap-4">
              {/* Imagen actual o placeholder */}
              <div className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                {logoPreview ? (
                  <img
                    src={logoPreview}
                    alt="Logo"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
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
                      <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      Subiendo...
                    </>
                  ) : (
                    'Cambiar logo'
                  )}
                </button>
                <p className="text-xs text-gray-400">JPG, PNG o WebP · Máx. 2 MB</p>
              </div>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              onChange={handleLogoSelect}
              className="hidden"
            />
          </div>
        </Section>

        {/* ── Sección 3: Alertas de inventario ── */}
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

        {/* Botón guardar */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
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
      </form>
    </div>
  );
}
