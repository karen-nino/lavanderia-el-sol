/** Campo de dinero: en cuanto tiene un número, lleva el $ a la izquierda. */
export default function ConPesos({ valor, children }) {
  const conValor = valor !== '' && valor != null;
  return (
    <div className={`relative ${conValor ? '[&>input]:pl-7' : ''}`}>
      {conValor && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-medium text-gray-500">$</span>
      )}
      {children}
    </div>
  );
}
