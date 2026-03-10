import bcrypt from 'bcrypt';
import readline from 'readline';
import pool from './pool.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Oculta la entrada mientras se escribe la contraseña
function preguntarPassword(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);

    const { stdin } = process;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let input = '';

    stdin.on('data', function handler(char) {
      if (char === '\r' || char === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', handler);
        process.stdout.write('\n');
        resolve(input);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.stdout.write('\n');
        process.exit();
      } else if (char === '\u007f') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(prompt + '*'.repeat(input.length));
        }
      } else {
        input += char;
        process.stdout.write('*');
      }
    });
  });
}

function preguntar(prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function main() {
  console.log('\n=== Lavanderia El Sol — Seed de usuario admin ===\n');

  const password = await preguntarPassword('Contraseña para admin: ');

  if (password.length < 8) {
    console.error('Error: la contraseña debe tener al menos 8 caracteres.');
    process.exit(1);
  }

  const confirmar = await preguntarPassword('Confirmar contraseña:   ');

  if (password !== confirmar) {
    console.error('Error: las contraseñas no coinciden.');
    process.exit(1);
  }

  rl.close();

  console.log('\nGenerando hash bcrypt (cost 12)...');
  const hash = await bcrypt.hash(password, 12);

  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE usuarios
       SET password = $1, updated_at = NOW()
       WHERE email = 'admin@lavanderia-el-sol.com'
       RETURNING id, nombre, email, rol`,
      [hash]
    );

    if (result.rowCount === 0) {
      console.error('No se encontró el usuario admin en la base de datos.');
      console.error('Asegúrate de haber ejecutado schema.sql primero.');
      process.exit(1);
    }

    const u = result.rows[0];
    console.log('\nUsuario actualizado correctamente:');
    console.log(`  ID:    ${u.id}`);
    console.log(`  Nombre: ${u.nombre}`);
    console.log(`  Email:  ${u.email}`);
    console.log(`  Rol:    ${u.rol}`);
    console.log('\nListo. Ya puedes iniciar sesión.\n');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\nError inesperado:', err.message);
  process.exit(1);
});
