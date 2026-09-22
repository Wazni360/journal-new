import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error('usage: node scripts/hash-password.js "<password>"');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
console.log(`APP_PASSWORD_HASH_B64=${Buffer.from(hash, "utf8").toString("base64")}`);
