const getDb = require("../dist/src/db/db").default;

(async () => {
  const db = await getDb();

  const pubkey = process.argv[2];
  const alias = process.argv[3];

  if (!pubkey) {
    console.log(`USAGE:\n   create-user.js pubkey alias`);
    process.exit(0);
  }

  await db.run("INSERT INTO user (pubkey, alias) VALUES ($pubkey, $alias)", {
    $pubkey: pubkey,
    $alias: alias,
  });

  console.log("Done");
})();
