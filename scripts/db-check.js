const ImageDatabase = require('../electron/main/database');

async function main() {
  const db = new ImageDatabase();
  await db.initialize();
  db.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


