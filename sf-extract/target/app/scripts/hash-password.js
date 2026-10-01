// Prints a CRMGENIE_USERS entry hash for a password read from stdin (never from the command line).
//   echo <password> | node scripts/hash-password.js
const { hashPassword } = require('../auth');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const pw = input.replace(/\r?\n$/, '');
  if (pw.length < 12) { console.error('password must be at least 12 characters'); process.exit(1); }
  process.stdout.write(hashPassword(pw));
});
