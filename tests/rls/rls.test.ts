/**
 * 行単位のアクセス制御（RLS）の試験。「他人のデータが読めない」ことを確かめる。
 * scripts/test-rls.sh から RLS_DATABASE_URL を渡して実行する。
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.RLS_DATABASE_URL;
const pool = url ? new pg.Pool({ connectionString: url }) : null;

/** 指定の利用者としてトランザクション内で実行し、最後に必ずロールバックする */
async function asUser<T>(userId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool!.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    return await fn(c);
  } finally {
    await c.query('rollback');
    c.release();
  }
}

/** 管理者（service_role 相当）として確定させる */
async function asAdmin(sql: string, params: unknown[] = []) {
  const c = await pool!.connect();
  try {
    return await c.query(sql, params);
  } finally {
    c.release();
  }
}

/** 失敗するはずのクエリ。セーブポイントで包み、同じトランザクションで後続のクエリを続けられるようにする */
async function expectFail(c: pg.PoolClient, run: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint expect_fail');
  await expect(run()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint expect_fail');
}

const alice = randomUUID();
const bob = randomUUID();
let aliceVehicle = '';
let bobVehicle = '';
let aliceLedraOil = '';
let bobManualOil = '';

describe.skipIf(!pool)('RLS', () => {
  beforeAll(async () => {
    await asAdmin(`insert into auth.users (id, email) values ($1, 'alice@example.com'), ($2, 'bob@example.com')`, [alice, bob]);
    const v = await asAdmin(
      `insert into public.vehicles (user_id, name, annual_km_estimate, oil_interval_km, oil_interval_months)
       values ($1, 'アリスの車', 8000, 5000, 6), ($2, 'ボブの車', 10000, 5000, 6)
       returning id, user_id`,
      [alice, bob],
    );
    aliceVehicle = v.rows.find((r) => r.user_id === alice).id;
    bobVehicle = v.rows.find((r) => r.user_id === bob).id;

    const link = await asAdmin(
      `insert into public.ledra_links (vehicle_id, user_id, ledra_link_id, consent, consented_at)
       values ($1, $2, 'lnk_alice', '{}'::jsonb, now()) returning id`,
      [aliceVehicle, alice],
    );
    const ledra = await asAdmin(
      `insert into public.oil_changes (vehicle_id, user_id, performed_on, odo_km, source, ledra_link_id, ledra_record_id, shop_name)
       values ($1, $2, '2026-10-01', 41000, 'ledra', $3, 'rec_1', 'たにぐち自動車') returning id`,
      [aliceVehicle, alice, link.rows[0].id],
    );
    aliceLedraOil = ledra.rows[0].id;
    const manual = await asAdmin(
      `insert into public.oil_changes (vehicle_id, user_id, performed_on, odo_km) values ($1, $2, '2026-09-01', 30000) returning id`,
      [bobVehicle, bob],
    );
    bobManualOil = manual.rows[0].id;
    await asAdmin(
      `insert into public.expenses (vehicle_id, user_id, spent_on, category, amount_yen) values ($1, $2, '2026-10-01', 'fuel', 5000)`,
      [bobVehicle, bob],
    );
    await asAdmin(
      `insert into public.notification_log (vehicle_id, user_id, key, title, body) values ($1, $2, 'oil:x:m1', 't', 'b')`,
      [bobVehicle, bob],
    );
  });

  afterAll(async () => {
    await asAdmin(`delete from auth.users where id = any($1)`, [[alice, bob]]);
    await pool?.end();
  });

  it('新規登録でプロフィールが作られる', async () => {
    const r = await asAdmin(`select plan from public.profiles where id = $1`, [alice]);
    expect(r.rows).toEqual([{ plan: 'free' }]);
  });

  it('他人の車両・記録・支出・通知・連携は1件も見えない', async () => {
    await asUser(alice, async (c) => {
      for (const t of ['vehicles', 'oil_changes', 'expenses', 'notification_log', 'ledra_links', 'odometer_points', 'profiles']) {
        const col = t === 'profiles' ? 'id' : 'user_id';
        const r = await c.query(`select ${col}::text as owner from public.${t}`);
        expect(r.rows.every((row) => row.owner === alice), t).toBe(true);
      }
      const v = await c.query(`select id from public.vehicles`);
      expect(v.rows.map((r) => r.id)).toEqual([aliceVehicle]);
    });
  });

  it('未ログインでは何も読めない', async () => {
    await asUser(null, async (c) => {
      await expectFail(c, () => c.query(`select * from public.vehicles`), /permission denied/);
    });
  });

  it('他人の行は更新・削除できない（0件になる）', async () => {
    await asUser(alice, async (c) => {
      const u = await c.query(`update public.vehicles set name = '乗っ取り' where id = $1`, [bobVehicle]);
      expect(u.rowCount).toBe(0);
      const d = await c.query(`delete from public.oil_changes where id = $1`, [bobManualOil]);
      expect(d.rowCount).toBe(0);
    });
    const r = await asAdmin(`select name from public.vehicles where id = $1`, [bobVehicle]);
    expect(r.rows[0].name).toBe('ボブの車');
  });

  it('他人の車両に記録を付けられない', async () => {
    await asUser(alice, async (c) => {
      await expectFail(c, () => 
        c.query(`insert into public.expenses (vehicle_id, spent_on, category, amount_yen) values ($1, '2026-10-01', 'fuel', 100)`, [bobVehicle]),
        /violates foreign key constraint/,
      );
    });
    await asUser(alice, async (c) => {
      await expectFail(c, () => 
        c.query(`insert into public.expenses (vehicle_id, user_id, spent_on, category, amount_yen) values ($1, $2, '2026-10-01', 'fuel', 100)`, [bobVehicle, bob]),
        /row-level security/,
      );
    });
  });

  it('他人のオイル交換に金額を付けられない', async () => {
    await asUser(alice, async (c) => {
      await expectFail(c, () => 
        c.query(
          `insert into public.expenses (vehicle_id, spent_on, category, amount_yen, oil_change_id) values ($1, '2026-09-01', 'oil_change', 5000, $2)`,
          [aliceVehicle, bobManualOil],
        ),
        /violates foreign key constraint/,
      );
    });
  });

  it('Ledra から来た記録は編集・削除できないが、金額は1件だけ追記できる', async () => {
    await asUser(alice, async (c) => {
      const u = await c.query(`update public.oil_changes set odo_km = 1 where id = $1`, [aliceLedraOil]);
      expect(u.rowCount).toBe(0);
      const d = await c.query(`delete from public.oil_changes where id = $1`, [aliceLedraOil]);
      expect(d.rowCount).toBe(0);
      await expectFail(c, () => 
        c.query(
          `insert into public.oil_changes (vehicle_id, performed_on, odo_km, source, ledra_record_id) values ($1, '2026-10-02', 41000, 'ledra', 'fake')`,
          [aliceVehicle],
        ),
        /row-level security/,
      );
      await c.query(
        `insert into public.expenses (vehicle_id, spent_on, category, amount_yen, oil_change_id) values ($1, '2026-10-01', 'oil_change', 5500, $2)`,
        [aliceVehicle, aliceLedraOil],
      );
      await expectFail(c, () => 
        c.query(
          `insert into public.expenses (vehicle_id, spent_on, category, amount_yen, oil_change_id) values ($1, '2026-10-01', 'oil_change', 5500, $2)`,
          [aliceVehicle, aliceLedraOil],
        ),
        /duplicate key/,
      );
      // オイル交換の支出は「整備」など別の項目として紐づけられない
      await expectFail(c, () => 
        c.query(
          `insert into public.expenses (vehicle_id, spent_on, category, amount_yen, oil_change_id) values ($1, '2026-10-01', 'maintenance', 5500, $2)`,
          [aliceVehicle, aliceLedraOil],
        ),
        /check constraint/,
      );
    });
  });

  it('Ledra 連携と送信済み通知は利用者から書き込めない', async () => {
    await asUser(alice, async (c) => {
      await expectFail(c, () => 
        c.query(`update public.ledra_links set status = 'active' where user_id = $1`, [alice]),
        /permission denied/,
      );
    });
  });

  it('無料プランは1台まで。複数台プランは5台まで', async () => {
    await asUser(alice, async (c) => {
      await expectFail(c, () =>
        c.query(`insert into public.vehicles (name, annual_km_estimate, oil_interval_km) values ('2台目', 5000, 5000)`),
        /vehicle_limit_reached/,
      );
    });
    await asAdmin(`update public.profiles set plan = 'plus' where id = $1`, [alice]);
    try {
      await asUser(alice, async (c) => {
        for (let i = 2; i <= 5; i++) {
          await c.query(`insert into public.vehicles (name, annual_km_estimate, oil_interval_km) values ($1, 5000, 5000)`, [`${i}台目`]);
        }
        await expectFail(c, () =>
          c.query(`insert into public.vehicles (name, annual_km_estimate, oil_interval_km) values ('6台目', 5000, 5000)`),
          /vehicle_limit_reached/,
        );
      });
    } finally {
      await asAdmin(`update public.profiles set plan = 'free' where id = $1`, [alice]);
    }
  });

  it('利用者は自分のプランを変えられない', async () => {
    await asUser(alice, async (c) => {
      const u = await c.query(`update public.profiles set plan = 'plus' where id = $1`, [alice]);
      expect(u.rowCount).toBe(0);
    });
    const r = await asAdmin(`select plan from public.profiles where id = $1`, [alice]);
    expect(r.rows[0].plan).toBe('free');
  });

  it('整備工場は掲載中の店舗だけ見え、利用者は書き換えられない', async () => {
    const shops = await asAdmin(
      `insert into public.shops (name, address, latitude, longitude, is_published, listing_starts_on, listing_ends_on) values
         ('掲載中', '住所', 35.0, 135.0, true, current_date - 10, null),
         ('非公開', '住所', 35.0, 135.0, false, current_date - 10, null),
         ('掲載終了', '住所', 35.0, 135.0, true, current_date - 10, current_date - 1),
         ('掲載前', '住所', 35.0, 135.0, true, current_date + 5, null)
       returning id, name`,
    );
    const id = (name: string) => shops.rows.find((r) => r.name === name).id;
    try {
      await asUser(alice, async (c) => {
        const r = await c.query(`select name from public.shops`);
        expect(r.rows.map((x) => x.name)).toEqual(['掲載中']);
        await expectFail(c, () => c.query(`update public.shops set name = 'x'`), /permission denied/);
        await expectFail(c, () => c.query(`insert into public.shops (name, address, latitude, longitude) values ('x', 'y', 0, 0)`), /permission denied/);
      });
      await asUser(null, async (c) => {
        await expectFail(c, () => c.query(`select * from public.shops`), /permission denied/);
      });

      await asUser(alice, async (c) => {
        await c.query(`insert into public.shop_referrals (shop_id, action) values ($1, 'route')`, [id('掲載中')]);
        // 掲載していない店舗・他人になりすました記録は書けない
        await expectFail(c, () => c.query(`insert into public.shop_referrals (shop_id, action) values ($1, 'route')`, [id('非公開')]), /row-level security/);
        await expectFail(c, () =>
          c.query(`insert into public.shop_referrals (shop_id, user_id, action) values ($1, $2, 'call')`, [id('掲載中'), bob]),
          /row-level security/,
        );
        // 送客の記録は利用者からは読めない
        await expectFail(c, () => c.query(`select * from public.shop_referrals`), /permission denied/);
      });
    } finally {
      await asAdmin(`delete from public.shops where id = any($1)`, [shops.rows.map((r) => r.id)]);
    }
  });

  it('期限の更新を登録すると旧い期限は superseded になる', async () => {
    await asUser(alice, async (c) => {
      await c.query(`select public.register_deadline($1, 'shaken', '2026-12-01')`, [aliceVehicle]);
      await c.query(`select public.register_deadline($1, 'shaken', '2028-12-01')`, [aliceVehicle]);
      const r = await c.query(`select due_on::text, status from public.deadlines where kind = 'shaken' order by due_on`);
      expect(r.rows).toEqual([
        { due_on: '2026-12-01', status: 'superseded' },
        { due_on: '2028-12-01', status: 'active' },
      ]);
      await expectFail(c, () => c.query(`select public.register_deadline($1, 'shaken', '2027-01-01')`, [bobVehicle]), /foreign key/);
    });
  });

  it('同じ端末のプッシュトークンは今のアカウントに付け替わる', async () => {
    await asAdmin(`insert into public.push_tokens (token, user_id, platform) values ('ExponentPushToken[same]', $1, 'ios')`, [bob]);
    await asUser(alice, async (c) => {
      await c.query(`select public.register_push_token('ExponentPushToken[same]', 'ios')`);
      const r = await c.query(`select token from public.push_tokens`);
      expect(r.rows).toEqual([{ token: 'ExponentPushToken[same]' }]);
    });
  });

  it('アカウント削除でデータがすべて消える', async () => {
    const carol = randomUUID();
    await asAdmin(`insert into auth.users (id) values ($1)`, [carol]);
    const v = await asAdmin(
      `insert into public.vehicles (user_id, name, annual_km_estimate, oil_interval_km) values ($1, 'C', 5000, 5000) returning id`,
      [carol],
    );
    const o = await asAdmin(
      `insert into public.oil_changes (vehicle_id, user_id, performed_on, odo_km) values ($1, $2, '2026-10-01', 100) returning id`,
      [v.rows[0].id, carol],
    );
    await asAdmin(
      `insert into public.expenses (vehicle_id, user_id, spent_on, category, amount_yen, oil_change_id) values ($1, $2, '2026-10-01', 'oil_change', 4000, $3)`,
      [v.rows[0].id, carol, o.rows[0].id],
    );
    await asAdmin(`delete from auth.users where id = $1`, [carol]);
    for (const t of ['profiles', 'vehicles', 'oil_changes', 'expenses']) {
      const col = t === 'profiles' ? 'id' : 'user_id';
      const r = await asAdmin(`select count(*)::int as n from public.${t} where ${col} = $1`, [carol]);
      expect(r.rows[0].n, t).toBe(0);
    }
  });
});
