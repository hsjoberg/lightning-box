const getDb = require("../dist/src/db/db").default;

(async () => {
  const db = await getDb();

  const userAlias = process.argv[2];
  const code = process.argv[3];

  if (!userAlias || !code) {
    console.log(`USAGE:\n   create-withdrawal-code.js userAlias code`);
    process.exit(0);
  }

  await db.run("INSERT INTO withdrawalCode (code, userAlias) VALUES ($code, $userAlias)", {
    $code: code,
    $userAlias: userAlias,
  });

  console.log("Done");
})();
