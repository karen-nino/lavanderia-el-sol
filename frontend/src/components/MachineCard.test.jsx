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

  // Segundo ciclo de la misma carga (mig. 108): una carga de ropa necesita dos
  // ciclos de 15 min seguidos, y al terminar el primero la máquina se queda sin
  // corriente hasta que alguien la re-arma.
  const nota = { folio: '0123-080726', tipo_servicio: 'AUTOSERVICIO' };

  it('ofrece otro ciclo cuando la carga todavía tiene ciclos disponibles', async () => {
    const onOtroCiclo = vi.fn();
    render(
      <MachineCard
        maquina={{ ...lavadoraTerminada, puede_otro_ciclo: true, espera_otro_ciclo: 0,
                   ciclos_carga: 1, ciclos_max: 2 }}
        nota={nota}
        onOtroCiclo={onOtroCiclo}
      />
    );

    expect(screen.getByText('Ciclo 1 de 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'OTRO CICLO' }));
    expect(onOtroCiclo).toHaveBeenCalled();
  });

  it('durante la pausa sin corriente el botón cuenta atrás y no se puede pulsar', async () => {
    const onOtroCiclo = vi.fn();
    render(
      <MachineCard
        maquina={{ ...lavadoraTerminada, puede_otro_ciclo: true, espera_otro_ciclo: 7,
                   ciclos_carga: 1, ciclos_max: 2 }}
        nota={nota}
        onOtroCiclo={onOtroCiclo}
      />
    );

    const boton = screen.getByRole('button', { name: 'OTRO CICLO EN 7s' });
    expect(boton).toBeDisabled();
    await userEvent.click(boton);
    expect(onOtroCiclo).not.toHaveBeenCalled();
  });

  it('agotados los ciclos, el MISMO botón pasa a finalizar: nunca hay dos', () => {
    render(
      <MachineCard maquina={{ ...lavadoraTerminada, puede_otro_ciclo: false }} nota={nota} />
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /OTRO CICLO/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'FINALIZAR CARGA' })).toBeInTheDocument();
  });

  it('en el primer ciclo hay un solo botón, y es el de continuar', () => {
    render(
      <MachineCard
        maquina={{ ...lavadoraTerminada, puede_otro_ciclo: true, espera_otro_ciclo: 0,
                   ciclos_carga: 1, ciclos_max: 2 }}
        nota={nota}
      />
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'OTRO CICLO' })).toBeInTheDocument();
  });

  // El secado es otro destino del mismo botón: una carga que aún debe secar no
  // se "finaliza", pasa a la secadora. Eso manda sobre el texto de cierre, pero
  // NO sobre el de continuar: el segundo ciclo va antes que el secado.
  it('con secado pendiente y ciclos agotados, el botón lleva al secado', () => {
    render(
      <MachineCard
        maquina={{ ...lavadoraTerminada, puede_otro_ciclo: false }}
        nota={{ ...nota, lavadoras_con_secado_ids: [7] }}
      />
    );

    expect(screen.getByRole('button', { name: 'INICIAR SECADO' })).toBeInTheDocument();
  });

  it('con secado pendiente pero ciclos por correr, primero el segundo ciclo', () => {
    render(
      <MachineCard
        maquina={{ ...lavadoraTerminada, puede_otro_ciclo: true, espera_otro_ciclo: 0,
                   ciclos_carga: 1, ciclos_max: 2 }}
        nota={{ ...nota, lavadoras_con_secado_ids: [7] }}
      />
    );

    expect(screen.getByRole('button', { name: 'OTRO CICLO' })).toBeInTheDocument();
  });

  it('muestra el error del servidor si el siguiente ciclo no se pudo iniciar', () => {
    render(
      <MachineCard
        maquina={{ ...lavadoraTerminada, puede_otro_ciclo: true, espera_otro_ciclo: 0 }}
        nota={nota}
        errorOtroCiclo="Esta carga ya corrió sus 2 ciclos."
      />
    );

    expect(screen.getByText('Esta carga ya corrió sus 2 ciclos.')).toBeInTheDocument();
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
