import { Database } from "sqlite";

export interface IUserDB {
  alias: string;
  pubkey: string;
}

export async function createUser(db: Database, { alias, pubkey }: IUserDB) {
  await db.run(
    `INSERT INTO user
      (alias, pubkey)
    VALUES
      ($alias, $pubkey)
    `,
    {
      $alias: alias,
      $pubkey: pubkey,
    },
  );
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
