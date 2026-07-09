import assert from 'node:assert/strict';
import test from 'node:test';

import { isReadOnlyTransactionError } from '@/lib/server/appStateStore';

// Regression for the PLATFORM-081b dry-run hotfix: a dry-run inspection against
// a read-only connection (e.g. a production read replica) must tolerate the
// `create table if not exists` bootstrap failing with SQLSTATE 25006
// (read_only_sql_transaction) so reads can still proceed. This isolates the
// exact-code detector that gates that tolerance — it must match ONLY 25006 so
// no genuine failure is ever swallowed.

test('isReadOnlyTransactionError matches SQLSTATE 25006', () => {
  assert.equal(isReadOnlyTransactionError({ code: '25006' }), true);
  assert.equal(
    isReadOnlyTransactionError(
      Object.assign(new Error('cannot execute CREATE TABLE in a read-only transaction'), {
        code: '25006',
      })
    ),
    true
  );
});

test('isReadOnlyTransactionError rejects other errors', () => {
  assert.equal(isReadOnlyTransactionError({ code: '42P01' }), false); // undefined_table
  assert.equal(isReadOnlyTransactionError({ code: 25006 }), false); // numeric, not the pg string code
  assert.equal(isReadOnlyTransactionError(new Error('connection refused')), false);
  assert.equal(isReadOnlyTransactionError(null), false);
  assert.equal(isReadOnlyTransactionError(undefined), false);
  assert.equal(isReadOnlyTransactionError('25006'), false);
});
