/**
 * Labor classification assignment for active + terminated workers
 * (same UPDATE path as PATCH /api/workers/:id/labor-classification).
 */
require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('worker labor-classification persistence', () => {
  let query;
  let pool;
  let classificationId;
  let classificationName;
  let activeWorkerId;
  let terminatedWorkerId;
  let skip = false;
  let previousActiveClassId = null;

  before(async () => {
    if (!process.env.DATABASE_URL) {
      skip = true;
      return;
    }
    ({ query, pool } = require('../db'));

    try {
      await query('SELECT 1 FROM labor_classifications LIMIT 1');
    } catch {
      skip = true;
      return;
    }

    const classResult = await query(
      `SELECT id, name FROM labor_classifications ORDER BY name LIMIT 1`
    );
    if (!classResult.rows.length) {
      skip = true;
      return;
    }
    classificationId = classResult.rows[0].id;
    classificationName = classResult.rows[0].name;

    const active = await query(
      `SELECT id, labor_classification_id FROM workers WHERE is_active = true LIMIT 1`
    );
    if (!active.rows.length) {
      skip = true;
      return;
    }
    activeWorkerId = active.rows[0].id;
    previousActiveClassId = active.rows[0].labor_classification_id;

    const termInsert = await query(
      `INSERT INTO workers (
         employee_code, first_name, last_name, standard_rate, is_active, paychex_worker_id
       ) VALUES ($1, 'Term', 'Worker', 20, false, $2)
       RETURNING id`,
      [`TERM-CLASS-${Date.now()}`, `pcx-term-${Date.now()}`]
    );
    terminatedWorkerId = termInsert.rows[0].id;
  });

  after(async () => {
    if (!query) return;
    if (terminatedWorkerId) {
      await query('DELETE FROM workers WHERE id = $1', [terminatedWorkerId]);
    }
    if (activeWorkerId) {
      await query(`UPDATE workers SET labor_classification_id = $1 WHERE id = $2`, [
        previousActiveClassId,
        activeWorkerId,
      ]);
    }
    if (pool) await pool.end();
  });

  it('updates labor_classification_id for active and terminated workers', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / fixtures unavailable');
      return;
    }

    for (const workerId of [activeWorkerId, terminatedWorkerId]) {
      const result = await query(
        `UPDATE workers
         SET labor_classification_id = $1
         WHERE id = $2
         RETURNING id, is_active, labor_classification_id`,
        [classificationId, workerId]
      );
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].labor_classification_id, classificationId);

      const joined = await query(
        `SELECT lc.name
         FROM workers w
         JOIN labor_classifications lc ON lc.id = w.labor_classification_id
         WHERE w.id = $1`,
        [workerId]
      );
      assert.equal(joined.rows[0].name, classificationName);
    }

    const term = await query(`SELECT is_active FROM workers WHERE id = $1`, [
      terminatedWorkerId,
    ]);
    assert.equal(term.rows[0].is_active, false);
  });

  it('rejects invalid laborClassificationId via foreign key', async (t) => {
    if (skip) {
      t.skip('DATABASE_URL / fixtures unavailable');
      return;
    }

    await assert.rejects(
      () =>
        query(
          `UPDATE workers SET labor_classification_id = $1 WHERE id = $2`,
          [99999999, activeWorkerId]
        ),
      /foreign key|violates/i
    );
  });
});
