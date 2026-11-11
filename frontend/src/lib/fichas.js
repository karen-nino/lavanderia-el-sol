// Textos del inventario de fichas (aparte para Fast Refresh).

/** "1 ficha", "2 fichas". */
export const textoFichas = (n) => `${n} ${Math.abs(Number(n)) === 1 ? 'ficha' : 'fichas'}`;
