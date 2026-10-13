require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const bcrypt = require('bcrypt');
const readline = require('readline');
const { pool, query } = require('../db');

const BCRYPT_COST = 10;
const MIN_PASSWORD_LENGTH = 10;

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function readOption(name) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return '';
}

function ask(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });
}

function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('A terminal is required to type the password. Pass --password or ADMIN_PASSWORD.'));
      return;
    }

    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';

    function onData(chunk) {
      if (chunk === '\n' || chunk === '\r' || chunk === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        stdout.write('\n');
        resolve(value);
        return;
      }
      if (chunk === '\u0003') {
        stdin.setRawMode(false);
        process.exit(1);
      }
      if (chunk === '\u007f' || chunk === '\b') {
        value = value.slice(0, -1);
        return;
      }
      value += chunk;
    }

    stdin.on('data', onData);
  });
}

async function collectIdentity() {
  const fromFlags = {
    name: readOption('name') || process.env.ADMIN_NAME || '',
    email: readOption('email') || process.env.ADMIN_EMAIL || '',
    password: readOption('password') || process.env.ADMIN_PASSWORD || '',
  };

  if (fromFlags.email && fromFlags.password) {
    return fromFlags;
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      'Name, email, and password are required. Use --name, --email, and --password, or ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD.'
    );
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const name = fromFlags.name || (await ask(rl, 'Name: '));
    const email = fromFlags.email || (await ask(rl, 'Email: '));
    rl.close();
    const password = fromFlags.password || (await askHidden('Password: '));
    return { name, email, password };
  } catch (error) {
    rl.close();
    throw error;
  }
}

async function createAdmin({ name, email, password }) {
  const trimmedEmail = String(email || '').trim().toLowerCase();
  const trimmedName = String(name || '').trim();

  if (!trimmedName) {
    throw new Error('Name is required.');
  }
  if (!isValidEmail(trimmedEmail)) {
    throw new Error('Email must look like name@example.com.');
  }
  if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const existing = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [trimmedEmail]);
  if (existing.rows.length > 0) {
    throw new Error(`An account already exists for ${trimmedEmail}.`);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const result = await query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, $3, 'system_admin')
     RETURNING id, email, name, role`,
    [trimmedEmail, passwordHash, trimmedName]
  );
  return result.rows[0];
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Copy backend/.env.example to backend/.env and edit it.');
  }

  const identity = await collectIdentity();
  const user = await createAdmin(identity);
  console.log(`Created system administrator ${user.email} (${user.role}).`);
  console.log('Password was not printed. Log in with the email and password you just chose.');
}

if (require.main === module) {
  main()
    .then(() => pool.end())
    .catch((error) => {
      console.error(error.message || error);
      pool.end().finally(() => process.exit(1));
    });
}

module.exports = {
  isValidEmail,
  createAdmin,
  MIN_PASSWORD_LENGTH,
  BCRYPT_COST,
};
