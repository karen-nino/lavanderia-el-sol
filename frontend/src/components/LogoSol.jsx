// Sol de la marca — el mismo dibujo que el icono de la app (public/icon.svg).
// Va en SVG y no como emoji (antes era 🫧) porque el emoji lo dibuja cada
// sistema a su manera: en la tablet salía como un glifo plano, no como el
// icono. El color se pone desde afuera con una clase de Tailwind.
export default function LogoSol({ className = 'w-16 h-16' }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      fill="none"
      stroke="currentColor"
      role="img"
      aria-label="Lavandería El Sol"
    >
      <g strokeWidth={3.5} strokeLinecap="round">
        <path d="M32 10v6M32 48v6M10 32h6M48 32h6" />
        <path d="M16.4 16.4l4.3 4.3M43.3 43.3l4.3 4.3M16.4 47.6l4.3-4.3M43.3 20.7l4.3-4.3" />
      </g>
      <circle cx="32" cy="32" r="10" fill="currentColor" />
    </svg>
  );
}
