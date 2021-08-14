import { Database } from "sqlite";

export interface IAuthenticationDB {
  userAlias: string;
  pubeky: string;
}

export interface IPaymentDB {
  paymentRequest: string;
  paymentRequestForward: string | null;
  userAlias: string;
  amountSat: number;
  settled: number;
  forwarded: number;
  comment: string | null;
}

export async function createPayment(
  db: Database,
  {
    paymentRequest,
    paymentRequestForward,
    userAlias,
    amountSat,
    settled,
    forwarded,
    comment,
  }: IPaymentDB,
) {
  await db.run(
    `INSERT INTO payment
      (
        paymentRequest,
        paymentRequestForward,
        userAlias,
        amountSat,
        settled,
        forwarded,
        comment
      )
    VALUES
      (
        $paymentRequest,
        $paymentRequestForward,
        $userAlias,
        $amountSat,
        $settled,
        $forwarded,
        $comment
      )
    `,
    {
      $paymentRequest: paymentRequest,
      $paymentRequestForward: paymentRequestForward,
      $userAlias: userAlias,
      $amountSat: amountSat,
      $settled: settled,
      $forwarded: forwarded,
      $comment: comment,
    },
  );
}

/**
 * Note: Updating paymentRequest, userAlias and comment is not allowed
 */
export async function updatePayment(
  db: Database,
  { paymentRequest, paymentRequestForward, settled, forwarded }: IPaymentDB,
) {
  await db.run(
    `UPDATE payment
    SET paymentRequestForward = $paymentRequestForward,
        settled = $settled,
        forwarded = $forwarded
    WHERE paymentRequest = $paymentRequest`,
    {
      $paymentRequestForward: paymentRequestForward,
      $settled: settled,
      $forwarded: forwarded,
      $paymentRequest: paymentRequest,
    },
  );
}

export function getPayment(db: Database, paymentRequest: string) {
  return db.get<IPaymentDB>(`SELECT * FROM payment WHERE paymentRequest = $paymentRequest`, {
    $paymentRequest: paymentRequest,
  });
}

export function getNonForwardedPayments(db: Database, userAlias: string) {
  return db.all<IPaymentDB[]>(
    `SELECT * FROM payment WHERE userAlias = $userAlias AND settled = 1 AND forwarded = 0`,
    {
      $userAlias: userAlias,
    },
  );
}

// TODO not sure about race conditions with this one...
export async function updatePaymentsSetAsForwarded(
  db: Database,
  userAlias: string,
  paymentRequestForward: string,
) {
  await db.run(
    `UPDATE payment
    SET paymentRequestForward = $paymentRequestForward, forwarded = 1
    WHERE userAlias = $userAlias AND settled = 1 AND forwarded = 0`,
    {
      $paymentRequestForward: paymentRequestForward,
      $userAlias: userAlias,
    },
  );
}
