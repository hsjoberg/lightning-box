import { Database } from "sqlite";

export interface IUserDB {
  alias: string;
  pubkey: string;
}

export async function createUser(db: Database, { alias, pubkey }: IUserDB) {
  const result = await db.run(
    `INSERT OR IGNORE INTO user
      (alias, pubkey)
    SELECT $alias, $pubkey
    WHERE NOT EXISTS (
      SELECT 1 FROM user WHERE pubkey = $pubkey
    )
    `,
    {
      $alias: alias,
      $pubkey: pubkey,
    },
  );

  return result.changes === 1;
}

export function getUserByPubkey(db: Database, pubkey: string) {
  return db.get<IUserDB>(`SELECT * FROM user WHERE pubkey = $pubkey`, {
    $pubkey: pubkey,
  });
}

export function getUserByAlias(db: Database, alias: string) {
  return db.get<IUserDB>(`SELECT * FROM user WHERE alias = $alias`, {
    $alias: alias,
  });
}
