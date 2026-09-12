// Aviso sonoro de "máquina lista": suena cuando una tarjeta pasa a verde y
// ofrece Iniciar Secado o Finalizar Carga. En la lavandería nadie está viendo
// la pantalla todo el tiempo, así que el ciclo terminado tiene que oírse.
//
// El tono se sintetiza con Web Audio (no hay archivo que cargar ni que se
// quede a medias con mala señal).

let ctx = null;
let preparado = false;

function contexto() {
  const AC = window.AudioContext ?? window.webkitAudioContext;
  if (!AC) return null; // navegador sin Web Audio: simplemente no suena
  if (!ctx) ctx = new AC();
  // El navegador suspende el audio hasta que hay un toque en la página.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Deja el audio listo aprovechando el primer toque del usuario: los navegadores
// no dejan sonar nada antes de eso, y el aviso llega cuando el empleado ya no
// está tocando la pantalla.
export function prepararAviso() {
  if (preparado) return;
  preparado = true;
  const despertar = () => { contexto(); };
  window.addEventListener('pointerdown', despertar, { once: true });
  window.addEventListener('keydown', despertar, { once: true });
}

// Un pitido corto con entrada y salida suaves (sin rampa se oye un "clic").
function pitido(ac, frecuencia, inicio, duracion, volumen = 0.22) {
  const osc  = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(frecuencia, inicio);
  gain.gain.setValueAtTime(0.0001, inicio);
  gain.gain.exponentialRampToValueAtTime(volumen, inicio + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
  osc.connect(gain).connect(ac.destination);
  osc.start(inicio);
  osc.stop(inicio + duracion + 0.05);
}

// Tres notas que suben, dos veces: se distingue del ruido de las máquinas y no
// se confunde con una notificación del celular.
export function reproducirAvisoCiclo() {
  const ac = contexto();
  if (!ac) return;
  try {
    const t0 = ac.currentTime + 0.05;
    const notas = [880, 1108.73, 1318.51];
    notas.forEach((f, i) => pitido(ac, f, t0 + i * 0.16, 0.15));
    notas.forEach((f, i) => pitido(ac, f, t0 + 0.62 + i * 0.16, 0.15));
  } catch { /* que no suene nunca rompe la pantalla */ }
}
