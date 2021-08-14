import { Database } from "sqlite";

export interface IWithdrawalCodeDB {
  code: string;
  userAlias: string;
}

export async function createWithdrawalCode(db: Database, { code, userAlias }: IWithdrawalCodeDB) {
  await db.run(
    `INSERT INTO payment
      (code, userAlias)
    VALUES
      ($code, $userAlias)
    `,
    {
      $code: code,
      $userAlias: userAlias,
    },
  );
}

export function getWithdrawalCode(db: Database, code: string) {
  return db.get<IWithdrawalCodeDB>(`SELECT * FROM withdrawalCode WHERE code = $code`, {
    $code: code,
  });
}

export function getWithdrawalCodes(db: Database, userAlias: string) {
  return db.all<IWithdrawalCodeDB[]>(`SELECT * FROM withdrawalCode WHERE userAlias = $userAlias`, {
    $userAlias: userAlias,
  });
}
