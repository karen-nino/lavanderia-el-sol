import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MachineCard from './MachineCard';

describe('MachineCard', () => {
  it('máquina disponible muestra su nombre y "Disponible"', () => {
    render(<MachineCard maquina={{ nombre: 'L1', estado: 'disponible' }} />);
    expect(screen.getByText('L1')).toBeInTheDocument();
    expect(screen.getByText('Disponible')).toBeInTheDocument();
  });

  it('máquina en mantenimiento lo indica', () => {
    render(<MachineCard maquina={{ nombre: 'L2', estado: 'mantenimiento' }} />);
    expect(screen.getByText('Mantenimiento')).toBeInTheDocument();
  });

  it('en uso muestra el folio y el cliente con apellido abreviado', () => {
    render(
      <MachineCard
        maquina={{ nombre: 'L1', estado: 'en_uso', tipo: 'lavadora_mediana', tiempo_restante: '12:00' }}
        nota={{ folio: '0123-080726', tipo_servicio: 'POR_ENCARGO', cliente_nombre: 'Ana', cliente_apellido: 'López' }}
      />
    );
    expect(screen.getByText('#0123')).toBeInTheDocument();
    expect(screen.getByText('Ana L.')).toBeInTheDocument();
  });

  it('en uso con autoservicio muestra "Autoservicio"', () => {
    render(
      <MachineCard
        maquina={{ nombre: 'L1', estado: 'en_uso', tipo: 'lavadora_mediana' }}
        nota={{ folio: '0200-080726', tipo_servicio: 'AUTOSERVICIO' }}
      />
    );
    expect(screen.getByText('Autoservicio')).toBeInTheDocument();
  });

  // Lo que decide el siguiente paso es si la CARGA lleva secado pendiente
  // (`lavadoras_con_secado_ids`, del servidor), no el tipo de servicio.
  const lavadoraTerminada = {
    id: 7, nombre: 'L1', estado: 'en_uso', tipo: 'lavadora_mediana', necesita_terminar_ciclo: true,
  };

  it('una lavadora cuya carga aún debe secar ofrece iniciar el secado y avisa al hacer clic', async () => {
    const onTerminarCiclo = vi.fn();
    render(
      <MachineCard
        maquina={lavadoraTerminada}
        nota={{ folio: '0123-080726', tipo_servicio: 'POR_ENCARGO', lavadoras_con_secado_ids: [7] }}
        onTerminarCiclo={onTerminarCiclo}
      />
    );

    const boton = screen.getByRole('button', { name: 'INICIAR SECADO' });
    await userEvent.click(boton);
    expect(onTerminarCiclo).toHaveBeenCalledWith(lavadoraTerminada);
  });

  it('un AUTOSERVICIO con secadora también pasa a secado, no finaliza la carga', () => {
    render(
      <MachineCard
        maquina={lavadoraTerminada}
        nota={{ folio: '0200-080726', tipo_servicio: 'AUTOSERVICIO', lavadoras_con_secado_ids: [7] }}
      />
    );
    expect(screen.getByRole('button', { name: 'INICIAR SECADO' })).toBeInTheDocument();
  });

  it('una lavadora cuya carga no lleva secado finaliza la carga', () => {
    render(
      <MachineCard
        maquina={lavadoraTerminada}
        nota={{ folio: '0200-080726', tipo_servicio: 'AUTOSERVICIO', lavadoras_con_secado_ids: [] }}
      />
    );
    expect(screen.getByRole('button', { name: 'FINALIZAR CARGA' })).toBeInTheDocument();
  });

  it('con onClick es un botón accionable y no dispara el ciclo', async () => {
    const onClick = vi.fn();
    render(<MachineCard maquina={{ nombre: 'L1', estado: 'disponible' }} onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
