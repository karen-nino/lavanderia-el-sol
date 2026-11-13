// Textos del inventario de fichas (aparte para Fast Refresh).

/** "1 ficha", "2 fichas". */
export const textoFichas = (n) => `${n} ${Math.abs(Number(n)) === 1 ? 'ficha' : 'fichas'}`;

/** ¿Al iniciarla se elige cuántas fichas? Solo si su modelo admite más de una; si no, lleva 1 sin preguntar. */
export const eligeFichas = (m) => Boolean(m?.pide_fichas) && (Number(m?.max_fichas) || 3) > 1;
