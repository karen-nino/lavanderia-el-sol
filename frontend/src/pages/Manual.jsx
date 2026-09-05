import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SECCIONES_MANUAL } from '../lib/manual/contenido';
import { buscarEnManual, contarArticulos, normalizar } from '../lib/manual/buscar';

const IconoBuscar = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <circle cx="11" cy="11" r="7" strokeWidth={2} />
    <path strokeLinecap="round" strokeWidth={2} d="M20 20l-3.5-3.5" />
  </svg>
);

// Resalta en amarillo lo que se buscó, para que el ojo caiga en el renglón sin
// releer el artículo entero. Trabaja sobre el texto ya partido para no tener
// que meter HTML en el contenido del manual.
function Resaltado({ texto, palabras }) {
  if (palabras.length === 0) return texto;
  const partes = texto.split(
    new RegExp(`(${palabras.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  );
  const esCoincidencia = (t) => palabras.includes(normalizar(t));
  return partes.map((t, i) =>
    esCoincidencia(t)
      ? <mark key={i} className="bg-yellow-200 text-inherit rounded px-0.5">{t}</mark>
      : t
  );
}

function Articulo({ art, abierto, onToggle, palabras }) {
  return (
    <div id={art.id} className="border-b border-gray-100 last:border-b-0 scroll-mt-28">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={abierto}
        className="w-full px-4 py-4 flex items-center justify-between gap-3 text-left hover:bg-gray-50 transition-colors print:hover:bg-transparent"
      >
        <span className="text-base font-medium text-dark-blue">
          <Resaltado texto={art.titulo} palabras={palabras} />
        </span>
        <svg
          className={`w-5 h-5 flex-shrink-0 text-gray-400 transition-transform print:hidden ${abierto ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {abierto && (
        <p className="px-4 pb-5 text-sm leading-relaxed text-gray-600 whitespace-pre-line">
          <Resaltado texto={art.cuerpo} palabras={palabras} />
        </p>
      )}
    </div>
  );
}

export default function Manual() {
  const navigate = useNavigate();
  const [consulta, setConsulta] = useState('');
  // Artículos desplegados a mano. Con una búsqueda en curso se ignoran: ahí se
  // abren todos los resultados, que es lo que se venía a leer.
  const [abiertos, setAbiertos] = useState(() => new Set());
  const buscadorRef = useRef(null);

  const secciones = useMemo(() => buscarEnManual(SECCIONES_MANUAL, consulta), [consulta]);
  const palabras  = useMemo(
    () => normalizar(consulta).split(/\s+/).filter(Boolean),
    [consulta]
  );
  const buscando  = palabras.length > 0;
  const total     = contarArticulos(secciones);

  // Enlace directo a un artículo (/manual#cobrar-una-nota): se abre y se sube a
  // él. Sirve para mandarle a alguien la instrucción exacta por chat.
  //
  // Se escucha también `hashchange` porque cambiar solo el hash NO recarga la
  // página: sin esto, a quien ya tuviera el manual abierto el enlace no le
  // hacía nada.
  useEffect(() => {
    let t;
    const abrirDelHash = () => {
      const id = window.location.hash.replace('#', '');
      if (!id) return;
      setAbiertos(new Set([id]));
      // Tras pintar, para que el elemento ya exista.
      t = setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ block: 'start' });
      }, 60);
    };
    abrirDelHash();
    window.addEventListener('hashchange', abrirDelHash);
    return () => { clearTimeout(t); window.removeEventListener('hashchange', abrirDelHash); };
  }, []);

  const alternar = (id) => setAbiertos((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const irASeccion = (id) => {
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // En papel el manual sirve más que en el teléfono cuando hay cola, así que
  // antes de imprimir se abren todos los artículos: uno plegado no se imprime.
  const imprimir = () => {
    setAbiertos(new Set(SECCIONES_MANUAL.flatMap(s => s.articulos.map(a => a.id))));
    setTimeout(() => window.print(), 80);
  };

  return (
    <div className="min-h-full bg-slate-100">
      {/* Cabecera */}
      <div className="bg-white border-b-2 border-gray-200 print:border-b-0">
        <div className="max-w-5xl mx-auto px-6 pt-10 md:pt-6 pb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/ajustes')}
              aria-label="Volver a Ajustes"
              className="flex-shrink-0 w-11 h-11 rounded-full border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 flex items-center justify-center transition duration-200 ease-out active:scale-[1.3] print:hidden"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-900 leading-tight">Manual de uso</h1>
              <p className="text-sm text-gray-500 leading-tight">Cómo funciona la aplicación</p>
            </div>
          </div>
          <button
            type="button"
            onClick={imprimir}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors print:hidden"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M6 9V3h12v6M6 18H4v-6h16v6h-2M8 14h8v7H8z" />
            </svg>
            Imprimir
          </button>
        </div>

        {/* Buscador: pegado bajo la cabecera, siempre a mano al ir bajando. */}
        <div className="max-w-5xl mx-auto px-6 pb-4 print:hidden">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{IconoBuscar}</span>
            <input
              ref={buscadorRef}
              type="search"
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
              placeholder="Buscar: cobrar, corte, bidón, máquina ocupada…"
              aria-label="Buscar en el manual"
              className="w-full pl-10 pr-4 py-3 bg-white border border-gray-300 rounded-lg text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue/30 focus:border-blue"
            />
          </div>
          {buscando && (
            <p className="mt-2 text-sm text-gray-500">
              {total === 0
                ? 'No encontré nada con esas palabras.'
                : `${total} ${total === 1 ? 'resultado' : 'resultados'}`}
            </p>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 flex gap-6">
        {/* Índice: solo en escritorio, donde sobra el ancho. */}
        {!buscando && (
          <nav className="hidden lg:block w-48 flex-shrink-0 print:hidden">
            <div className="sticky top-6 space-y-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 pb-1">
                Contenido
              </p>
              {SECCIONES_MANUAL.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => irASeccion(sec.id)}
                  className="block w-full text-left px-3 py-2 text-sm text-gray-600 rounded-lg hover:bg-white hover:text-dark-blue transition-colors"
                >
                  {sec.titulo}
                </button>
              ))}
            </div>
          </nav>
        )}

        <div className="flex-1 min-w-0 space-y-6">
          {total === 0 ? (
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-8 text-center">
              <p className="text-base font-medium text-dark-blue">Sin resultados</p>
              <p className="text-sm text-gray-500 mt-1">
                Prueba con una palabra más corta, o con cómo lo dirías en el mostrador
                («cobrar», «contar el dinero», «bolsa»).
              </p>
              <button
                type="button"
                onClick={() => { setConsulta(''); buscadorRef.current?.focus(); }}
                className="mt-4 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Ver el manual completo
              </button>
            </div>
          ) : (
            secciones.map((sec) => (
              <section key={sec.id} id={`sec-${sec.id}`} className="scroll-mt-6">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide px-1 pb-2">
                  {sec.titulo}
                </h2>
                <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                  {sec.articulos.map((art) => (
                    <Articulo
                      key={art.id}
                      art={art}
                      abierto={buscando || abiertos.has(art.id)}
                      onToggle={() => alternar(art.id)}
                      palabras={palabras}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
