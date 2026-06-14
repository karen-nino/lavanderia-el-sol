import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import KpiCard from '../components/KpiCard';
import MachineCard from '../components/MachineCard';
import SalesCard from '../components/SalesCard';
import CashCutCard from '../components/CashCutCard';

const KpiIcon = {
  machine: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="4" y="3" width="16" height="18" rx="2" strokeWidth={2} />
      <circle cx="12" cy="13" r="4" strokeWidth={2} />
    </svg>
  ),
  paid: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  waiting: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  deliver: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
};

function formatMMSS(totalSegundos) {
  const s = Math.max(0, Math.floor(totalSegundos));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [notas, setNotas]       = useState([]);
  const [maquinas, setMaquinas] = useState([]);
  const [tiempos, setTiempos]   = useState({ mediana: 30, jumbo: 45 });
  const [ventas, setVentas]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [now, setNow]           = useState(() => Date.now());
  const [confirmProcesar, setConfirmProcesar] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [errorProcesar, setErrorProcesar] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/notas'),
      api.get('/maquinas'),
      api.get('/ventas/resumen?periodo=hoy').catch(() => null),
      api.get('/ajustes').catch(() => null),
    ])
      .then(([n, m, v, a]) => {
        setNotas(n);
        setMaquinas(m);
        setVentas(v);
        if (a) {
          setTiempos({
            mediana: a.tiempo_carga_mediana != null ? Number(a.tiempo_carga_mediana) : 30,
            jumbo:   a.tiempo_carga_jumbo   != null ? Number(a.tiempo_carga_jumbo)   : 45,
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const notaParaProcesar = confirmProcesar
    ? notas
        .filter(n => String(n.maquina_id) === String(confirmProcesar.id)
                  && n.estado === 'EN_PROCESO')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
    : null;

  const confirmarProcesar = async () => {
    if (!confirmProcesar) return;
    setProcesando(true);
    setErrorProcesar('');
    try {
      if (notaParaProcesar) {
        const notaActualizada = await api.patch(`/notas/${notaParaProcesar.id}/estado`, { estado: 'LISTA' });
        setNotas(prev => prev.map(n => n.id === notaActualizada.id ? { ...n, ...notaActualizada } : n));
      }
      const actualizada = await api.patch(`/maquinas/${confirmProcesar.id}/estado`, { estado: 'disponible' });
      setMaquinas(prev => prev.map(m => m.id === actualizada.id ? actualizada : m));
      setConfirmProcesar(null);
    } catch (err) {
      setErrorProcesar(err.message);
    } finally {
      setProcesando(false);
    }
  };

  const totalMaquinas    = maquinas.length;
  const enUso            = maquinas.filter(m => m.estado === 'en_uso').length;
  const notasPagadas     = notas.filter(n => n.estado_pago === 'PAGADO').length;
  const notasEnEspera    = notas.filter(n => n.estado === 'EN_PROCESO').length;
  const paraEntregar     = notas.filter(n => ['LISTA', 'PAGADA'].includes(n.estado)).length;
  const ventasHoy        = ventas?.tarjetas?.total_cobrado ?? 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-pill h-8 w-8 border-b-2 border-blue" />
      </div>
    );
  }

  return (
    <div className="pt-4 pb-16 px-6 md:py-10 md:px-8 space-y-12">

      <div className="space-y-4">
        <p className="text-card-title text-grey">Hoy</p>

        {/* KPIs: 2x2 en mobile, 4 columnas en tablet */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Máquinas en uso"
            value={`${enUso}/${totalMaquinas}`}
            color="blue"
            icon={KpiIcon.machine}
          />
          <KpiCard
            label="Notas pagadas"
            value={notasPagadas}
            color="green"
            icon={KpiIcon.paid}
          />
          <KpiCard
            label="Notas en espera"
            value={notasEnEspera}
            color="red"
            icon={KpiIcon.waiting}
          />
          <KpiCard
            label="Para entregar"
            value={paraEntregar}
            color="bronce"
            icon={KpiIcon.deliver}
          />
        </div>
      </div>


      {/* Sección ventas + máquinas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-12">

        <div className="space-y-12">
          <div className="space-y-6">
            <p className="text-card-title text-grey">Ventas</p>

            <div className="space-y-4">
              <SalesCard total={ventasHoy} label="Ingresado hoy" />
            </div>
          </div>

          <div className="space-y-6">
            <p className="text-card-title text-grey">Corte de caja</p>

            <div className="space-y-4">
              <CashCutCard />
            </div>
          </div>
        </div>



        <div className="md:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-section text-dark-blue">Máquinas en uso <span className="text-grey">({enUso})</span></h2>
          </div>

          {(() => {
            const maquinasEnUso = maquinas.filter(m => m.estado === 'en_uso');
            if (maquinasEnUso.length === 0) {
              return (
                <div className="rounded-card bg-white p-card-pad shadow-card text-center">
                  <p className="text-kpi-label text-grey">Sin máquinas en uso</p>
                </div>
              );
            }
            return (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
                {maquinasEnUso.map(m => {
                  const minutos = m.tipo === 'lavadora_jumbo' ? tiempos.jumbo : tiempos.mediana;
                  const duracionSeg = Math.max(0, Number(minutos) || 0) * 60;
                  const inicio = m.en_uso_desde ? new Date(m.en_uso_desde).getTime() : null;
                  const transcurridoSeg = inicio ? Math.max(0, Math.floor((now - inicio) / 1000)) : 0;
                  const restanteSeg = Math.max(0, duracionSeg - transcurridoSeg);
                  const expirado = inicio != null && transcurridoSeg >= duracionSeg;
                  const progreso = duracionSeg > 0 ? restanteSeg / duracionSeg : 0;
                  const maquinaAumentada = {
                    ...m,
                    progreso,
                    tiempo_restante: inicio ? formatMMSS(restanteSeg) : '—:—',
                    necesita_procesar: expirado,
                  };
                  const notaRel = notas
                    .filter(n => String(n.maquina_id) === String(m.id)
                              && n.estado === 'EN_PROCESO')
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
                  return (
                    <MachineCard
                      key={m.id}
                      maquina={maquinaAumentada}
                      nota={notaRel}
                      onProcesar={() => setConfirmProcesar(maquinaAumentada)}
                      onClick={notaRel ? () => navigate(`/notas/${notaRel.id}`) : undefined}
                    />
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

      {confirmProcesar && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Procesar carga</h3>
            <p className="text-sm text-gray-500">
              ¿Confirmar que la carga de <span className="font-semibold text-gray-800">{confirmProcesar.nombre}</span> ya terminó? La máquina pasará a disponible.
            </p>
            {notaParaProcesar && (
              <p className="text-sm text-gray-500">
                La nota <span className="font-semibold text-gray-800">{notaParaProcesar.folio ?? `#${notaParaProcesar.id}`}</span> pasará a estado <span className="font-semibold text-gray-800">"Por Entregar"</span>.
              </p>
            )}
            {errorProcesar && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {errorProcesar}
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setConfirmProcesar(null); setErrorProcesar(''); }}
                disabled={procesando}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarProcesar}
                disabled={procesando}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
              >
                {procesando ? 'Procesando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Link
        to="/notas/nueva"
        aria-label="Nueva nota"
        className="fixed bottom-24 right-4 md:bottom-8 md:right-8 w-16 h-16 rounded-pill bg-blue text-white shadow-card flex items-center justify-center hover:opacity-90 transition-opacity z-40"
      >
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </Link>
    </div>
  );
}
