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

  it('愛車の写真は本人のフォルダだけ読み書きできる', async () => {
    await asUser(alice, async (c) => {
      await c.query(`insert into storage.objects (bucket_id, name) values ('vehicle-photos', $1)`, [`${alice}/${aliceVehicle}-1.jpg`]);
      await expectFail(c, () =>
        c.query(`insert into storage.objects (bucket_id, name) values ('vehicle-photos', $1)`, [`${bob}/${bobVehicle}-1.jpg`]),
        /row-level security/,
      );
      const own = await c.query(`select name from storage.objects where bucket_id = 'vehicle-photos'`);
      expect(own.rows.map((r) => r.name)).toEqual([`${alice}/${aliceVehicle}-1.jpg`]);
    });
    await asAdmin(`insert into storage.objects (bucket_id, name, owner) values ('vehicle-photos', $1, $2)`, [`${bob}/${bobVehicle}-1.jpg`, bob]);
    try {
      await asUser(alice, async (c) => {
        const r = await c.query(`select name from storage.objects where name like $1`, [`${bob}/%`]);
        expect(r.rows).toEqual([]);
        const d = await c.query(`delete from storage.objects where name like $1`, [`${bob}/%`]);
        expect(d.rowCount).toBe(0);
      });
    } finally {
      await asAdmin(`delete from storage.objects where name like $1`, [`${bob}/%`]);
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

  describe('お知らせ・スポンサー広告', () => {
    const holy = randomUUID();
    const taniguchi = randomUUID();

    beforeAll(async () => {
      await asAdmin(`insert into auth.users (id) values ($1), ($2)`, [holy, taniguchi]);
      await asAdmin(`insert into public.staff_members (user_id, org) values ($1, 'holy'), ($2, 'taniguchi')`, [holy, taniguchi]);
    });

    afterAll(async () => {
      await asAdmin(`delete from public.announcements`);
      await asAdmin(`delete from public.sponsor_ads`);
      await asAdmin(`delete from auth.users where id = any($1)`, [[holy, taniguchi]]);
    });

    it('利用者は公開中のお知らせだけ見え、書き込めない', async () => {
      await asAdmin(
        `insert into public.announcements (category, title, body, is_published, published_at, expires_at, org) values
           ('app_update', '公開中', '本文', true, now() - interval '1 hour', null, 'holy'),
           ('shop_news', '下書き', '本文', false, now() - interval '1 hour', null, 'taniguchi'),
           ('shop_news', '予約', '本文', true, now() + interval '1 day', null, 'taniguchi'),
           ('app_update', '掲載終了', '本文', true, now() - interval '2 day', now() - interval '1 day', 'holy')`,
      );
      await asUser(alice, async (c) => {
        const r = await c.query(`select title from public.announcements`);
        expect(r.rows.map((x) => x.title)).toEqual(['公開中']);
        await expectFail(c, () => c.query(`insert into public.announcements (category, title, body) values ('app_update', 'x', 'y')`), /row-level security/);
        const u = await c.query(`update public.announcements set title = '乗っ取り'`);
        expect(u.rowCount).toBe(0);
      });
      await asUser(null, async (c) => {
        await expectFail(c, () => c.query(`select * from public.announcements`), /permission denied/);
      });
    });

    it('HOLY は両方、たにぐち自動車は最新情報だけを出せる。下書きはスタッフに見える', async () => {
      await asUser(taniguchi, async (c) => {
        const r = await c.query(`select count(*)::int as n from public.announcements`);
        expect(r.rows[0].n).toBe(4);
        const ins = await c.query(
          `insert into public.announcements (category, title, body, is_published) values ('shop_news', '新しいオイル入荷', '本文', true) returning org, created_by`,
        );
        expect(ins.rows[0]).toEqual({ org: 'taniguchi', created_by: taniguchi });
        await expectFail(c, () => c.query(`insert into public.announcements (category, title, body) values ('app_update', 'x', 'y')`), /row-level security/);
        const u = await c.query(`update public.announcements set title = 'x' where category = 'app_update'`);
        expect(u.rowCount).toBe(0);
      });
      await asUser(holy, async (c) => {
        await c.query(`insert into public.announcements (category, title, body) values ('app_update', 'v1.1', '修正しました')`);
        await c.query(`insert into public.announcements (category, title, body) values ('shop_news', '代わりに投稿', '本文')`);
      });
    });

    it('送った記録（pushed_at）と書いた会社はスタッフも書き換えられない', async () => {
      await asUser(holy, async (c) => {
        await expectFail(c, () => c.query(`update public.announcements set pushed_at = null`), /permission denied/);
        await expectFail(c, () => c.query(`update public.announcements set org = 'taniguchi'`), /permission denied/);
      });
    });

    it('最新情報の受け取りは本人だけが変えられ、プランは変わらない', async () => {
      await asUser(alice, async (c) => {
        await c.query(`select public.set_shop_news_opt_in(true)`);
        await c.query(`select public.mark_announcements_seen()`);
        const r = await c.query(`select plan, shop_news_opt_in, shop_news_opt_in_at is not null as at, announcements_seen_at is not null as seen from public.profiles`);
        expect(r.rows).toEqual([{ plan: 'free', shop_news_opt_in: true, at: true, seen: true }]);
        await expectFail(c, () => c.query(`select * from public.announcement_push_tokens('app_update', null, 10)`), /permission denied/);
      });
      const bobProfile = await asAdmin(`select shop_news_opt_in from public.profiles where id = $1`, [bob]);
      expect(bobProfile.rows[0].shop_news_opt_in).toBeNull();
    });

    it('最新情報のプッシュは受け取ると選んだ利用者だけに送る', async () => {
      await asAdmin(`insert into public.push_tokens (token, user_id, platform) values ('tok-alice', $1, 'ios'), ('tok-bob', $2, 'android')`, [alice, bob]);
      await asAdmin(`update public.profiles set shop_news_opt_in = (id = $1) where id = any($2)`, [alice, [alice, bob]]);
      try {
        const c = await pool!.connect();
        try {
          await c.query('begin');
          await c.query('set local role service_role');
          const app = await c.query(`select token from public.announcement_push_tokens('app_update', null, 100) where token like 'tok-%'`);
          expect(app.rows.map((r) => r.token)).toEqual(['tok-alice', 'tok-bob']);
          const shop = await c.query(`select token from public.announcement_push_tokens('shop_news', null, 100) where token like 'tok-%'`);
          expect(shop.rows.map((r) => r.token)).toEqual(['tok-alice']);
          const page = await c.query(`select token from public.announcement_push_tokens('app_update', 'tok-alice', 100) where token like 'tok-%'`);
          expect(page.rows.map((r) => r.token)).toEqual(['tok-bob']);
        } finally {
          await c.query('rollback');
          c.release();
        }
      } finally {
        await asAdmin(`delete from public.push_tokens where token like 'tok-%'`);
      }
    });

    it('広告は掲載中のものだけ見え、各社は自社の広告だけ編集できる（HOLY はすべて）', async () => {
      const ads = await asAdmin(
        `insert into public.sponsor_ads (org, sponsor_name, title, placements, is_published, starts_on, ends_on) values
           ('taniguchi', 'たにぐち自動車', '掲載中', '{home,costs}', true, current_date - 1, null),
           ('holy', 'HOLY', '下書き', '{home}', false, current_date - 1, null),
           ('taniguchi', 'X社', '掲載終了', '{home}', true, current_date - 10, current_date - 1)
         returning id, title`,
      );
      const id = (title: string) => ads.rows.find((r) => r.title === title).id;
      await asUser(alice, async (c) => {
        const r = await c.query(`select title from public.sponsor_ads`);
        expect(r.rows.map((x) => x.title)).toEqual(['掲載中']);
        await expectFail(c, () => c.query(`insert into public.sponsor_ads (org, sponsor_name, title) values ('holy', 'x', 'y')`), /row-level security/);
        // 表示・タップは掲載中の広告の、出している場所にだけ記録できる。記録は読めない
        await c.query(`insert into public.sponsor_ad_events (ad_id, action, placement) values ($1, 'impression', 'home'), ($1, 'click', 'costs')`, [id('掲載中')]);
        await expectFail(c, () => c.query(`insert into public.sponsor_ad_events (ad_id, action, placement) values ($1, 'impression', 'shops')`, [id('掲載中')]), /row-level security/);
        await expectFail(c, () => c.query(`insert into public.sponsor_ad_events (ad_id, action, placement) values ($1, 'impression', 'home')`, [id('下書き')]), /row-level security/);
        await expectFail(c, () =>
          c.query(`insert into public.sponsor_ad_events (ad_id, user_id, action, placement) values ($1, $2, 'click', 'home')`, [id('掲載中'), bob]),
          /row-level security/,
        );
        await expectFail(c, () => c.query(`select * from public.sponsor_ad_events`), /permission denied/);
        await expectFail(c, () => c.query(`select * from public.sponsor_ad_stats(current_date, current_date)`), /not_staff/);
      });
      await asUser(taniguchi, async (c) => {
        const all = await c.query(`select count(*)::int as n from public.sponsor_ads`);
        expect(all.rows[0].n).toBe(3);
        const own = await c.query(`update public.sponsor_ads set weight = 5 where id = $1`, [id('掲載中')]);
        expect(own.rowCount).toBe(1);
        const other = await c.query(`update public.sponsor_ads set weight = 5 where id = $1`, [id('下書き')]);
        expect(other.rowCount).toBe(0);
        await expectFail(c, () => c.query(`update public.sponsor_ads set org = 'holy' where id = $1`, [id('掲載中')]), /row-level security/);
        await expectFail(c, () => c.query(`insert into public.sponsor_ads (org, sponsor_name, title) values ('holy', 'x', 'y')`), /row-level security/);
        const ins = await c.query(`insert into public.sponsor_ads (sponsor_name, title) values ('Y社', '新しい広告') returning org`);
        expect(ins.rows[0].org).toBe('taniguchi');
      });
      await asUser(holy, async (c) => {
        const u = await c.query(`update public.sponsor_ads set weight = 3 where id = any($1)`, [ads.rows.map((r) => r.id)]);
        expect(u.rowCount).toBe(3);
      });
    });

    it('表示・タップの集計はスタッフが自社の広告（HOLY はすべて）の分だけ読める', async () => {
      const ad = await asAdmin(
        `insert into public.sponsor_ads (org, sponsor_name, title, is_published, starts_on) values ('holy', 'HOLY', '集計用', true, current_date - 1) returning id`,
      );
      const adId = ad.rows[0].id;
      await asAdmin(
        `insert into public.sponsor_ad_events (ad_id, user_id, action, placement) values ($1, $2, 'impression', 'home'), ($1, $2, 'impression', 'home'), ($1, $3, 'click', 'home')`,
        [adId, alice, bob],
      );
      const today = `(now() at time zone 'Asia/Tokyo')::date`;
      await asUser(holy, async (c) => {
        const r = await c.query(`select impressions::int, clicks::int, users::int from public.sponsor_ad_stats(${today}, ${today}) where ad_id = $1`, [adId]);
        expect(r.rows).toEqual([{ impressions: 2, clicks: 1, users: 2 }]);
      });
      await asUser(taniguchi, async (c) => {
        const r = await c.query(`select * from public.sponsor_ad_stats(${today}, ${today}) where ad_id = $1`, [adId]);
        expect(r.rows).toEqual([]);
      });
    });

    it('広告の画像はスタッフだけが置ける', async () => {
      await asUser(alice, async (c) => {
        await expectFail(c, () => c.query(`insert into storage.objects (bucket_id, name) values ('sponsor-images', 'x.jpg')`), /row-level security/);
      });
      await asUser(taniguchi, async (c) => {
        await c.query(`insert into storage.objects (bucket_id, name) values ('sponsor-images', 'ad-1.jpg')`);
      });
    });
  });

  it('タイヤ・ブレーキ：他人の記録は見えず、Ledra から来た記録は書き換えられない', async () => {
    const link = await asAdmin(`select id from public.ledra_links where user_id = $1`, [alice]);
    await asAdmin(
      `insert into public.wear_checks (vehicle_id, user_id, kind, performed_on, odo_km, remaining_mm, source, ledra_link_id, ledra_record_id)
       values ($1, $2, 'tire', '2026-10-01', 41000, 4.5, 'ledra', $3, 'rec_1')`,
      [aliceVehicle, alice, link.rows[0].id],
    );
    await asAdmin(`insert into public.wear_checks (vehicle_id, user_id, kind, performed_on, odo_km) values ($1, $2, 'brake', '2026-09-01', 30100)`, [
      bobVehicle,
      bob,
    ]);
    await asUser(alice, async (c) => {
      const mine = await c.query(`select user_id::text as owner, source from public.wear_checks`);
      expect(mine.rows).toEqual([{ owner: alice, source: 'ledra' }]);
      // 走行距離はペースの計算にも入る
      const points = await c.query(`select source from public.odometer_points where source = 'wear_check'`);
      expect(points.rowCount).toBe(1);
      const u = await c.query(`update public.wear_checks set remaining_mm = 8 where source = 'ledra'`);
      expect(u.rowCount).toBe(0);
      const d = await c.query(`delete from public.wear_checks where source = 'ledra'`);
      expect(d.rowCount).toBe(0);
      await expectFail(
        c,
        () =>
          c.query(
            `insert into public.wear_checks (vehicle_id, kind, performed_on, source, ledra_record_id) values ($1, 'tire', '2026-10-02', 'ledra', 'fake')`,
            [aliceVehicle],
          ),
        /row-level security/,
      );
      await expectFail(
        c,
        () => c.query(`insert into public.wear_checks (vehicle_id, kind, performed_on) values ($1, 'brake', '2026-10-02')`, [bobVehicle]),
        /violates foreign key constraint/,
      );
      const own = await c.query(
        `insert into public.wear_checks (vehicle_id, kind, performed_on, replaced, remaining_mm) values ($1, 'tire', '2026-10-20', true, 8.0) returning id`,
        [aliceVehicle],
      );
      const edited = await c.query(`update public.wear_checks set remaining_mm = 7.5 where id = $1`, [own.rows[0].id]);
      expect(edited.rowCount).toBe(1);
      await expectFail(
        c,
        () => c.query(`insert into public.wear_checks (vehicle_id, kind, performed_on, remaining_mm) values ($1, 'tire', '2026-10-20', 31)`, [aliceVehicle]),
        /check constraint/,
      );
    });
  });

  it('入力の計測は本人の分を追加できるだけで、読めない・変えられない', async () => {
    const insert = (c: pg.PoolClient, userId: string, vehicleId: string) =>
      c.query(
        `insert into public.input_sessions (user_id, vehicle_id, kind, mode, method, outcome, opened_at, finished_at, record_ref)
         values ($1, $2, 'tire', 'new', 'voice', 'saved', now() - interval '40 seconds', now(), 'wear:x')`,
        [userId, vehicleId],
      );
    await asUser(alice, async (c) => {
      await insert(c, alice, aliceVehicle);
      await expectFail(c, () => insert(c, bob, bobVehicle), /row-level security/);
      await expectFail(c, () => insert(c, alice, bobVehicle), /violates foreign key constraint/);
      await expectFail(c, () => c.query(`select * from public.input_sessions`), /permission denied/);
      await expectFail(c, () => c.query(`delete from public.input_sessions`), /permission denied/);
      // 保存したのに記録の参照が無い行は受け付けない
      await expectFail(
        c,
        () =>
          c.query(
            `insert into public.input_sessions (vehicle_id, kind, mode, method, outcome, opened_at, finished_at) values ($1, 'tire', 'new', 'manual', 'saved', now(), now())`,
            [aliceVehicle],
          ),
        /check constraint/,
      );
    });
    await asUser(null, async (c) => {
      await expectFail(c, () => c.query(`select * from public.wear_checks`), /permission denied/);
    });
  });

  it('手放したクルマ（乗り換え・廃車）には記録を足せず、台数の上限にも数えない', async () => {
    const dave = randomUUID();
    await asAdmin(`insert into auth.users (id) values ($1)`, [dave]);
    try {
      const v = await asAdmin(
        `insert into public.vehicles (user_id, name, annual_km_estimate, oil_interval_km) values ($1, '前の車', 5000, 5000) returning id`,
        [dave],
      );
      const oldId = v.rows[0].id;
      await asAdmin(`insert into public.expenses (vehicle_id, user_id, spent_on, category, amount_yen) values ($1, $2, '2026-10-01', 'fuel', 3000)`, [oldId, dave]);

      // 利用者は自分では手放す状態を変えられない（連携の解除と一緒にサーバーが行う）
      await asUser(dave, async (c) => {
        await expectFail(c, () => c.query(`update public.vehicles set status = 'scrapped', released_at = now() where id = $1`, [oldId]), /release_via_server/);
      });

      await asAdmin(`update public.vehicles set status = 'scrapped', released_on = current_date, released_at = now() where id = $1`, [oldId]);

      await asUser(dave, async (c) => {
        await expectFail(c, () =>
          c.query(`insert into public.expenses (vehicle_id, spent_on, category, amount_yen) values ($1, '2026-10-02', 'fuel', 100)`, [oldId]),
          /vehicle_released/,
        );
        await expectFail(c, () => c.query(`insert into public.odometer_readings (vehicle_id, read_on, odo_km) values ($1, '2026-10-02', 100)`, [oldId]), /vehicle_released/);
        await expectFail(c, () => c.query(`insert into public.wear_checks (vehicle_id, kind, performed_on) values ($1, 'tire', '2026-10-02')`, [oldId]), /vehicle_released/);
        await expectFail(c, () => c.query(`update public.expenses set amount_yen = 1 where vehicle_id = $1`, [oldId]), /vehicle_released/);
        await expectFail(c, () => c.query(`delete from public.expenses where vehicle_id = $1`, [oldId]), /vehicle_released/);
        await expectFail(c, () => c.query(`update public.vehicles set name = 'x' where id = $1`, [oldId]), /vehicle_released/);
        await expectFail(c, () => c.query(`delete from public.vehicles where id = $1`, [oldId]), /vehicle_released/);
        await expectFail(c, () => c.query(`select public.register_deadline($1, 'shaken', '2027-01-01')`, [oldId]), /vehicle_released/);
        // 無料プランでも、手放したクルマは数えずに新しいクルマを登録できる
        await c.query(`insert into public.vehicles (name, annual_km_estimate, oil_interval_km) values ('新しい車', 5000, 5000)`);
      });

      // 記録は消さずに残る
      const kept = await asAdmin(`select count(*)::int as n from public.expenses where vehicle_id = $1`, [oldId]);
      expect(kept.rows[0].n).toBe(1);

      // 廃車では「次の持ち主に引き継ぐ」は選べない
      await expect(asAdmin(`update public.vehicles set history_share_consent = true where id = $1`, [oldId])).rejects.toThrow(/vehicles_release_consistent/);
    } finally {
      await asAdmin(`delete from auth.users where id = $1`, [dave]);
    }
  });

  describe('複数台プランの課金', () => {
    const erin = randomUUID();
    const vehicles: string[] = [];

    /** 定期購入の記録を、使える期限を指定して入れる（サーバーが確認したことにする） */
    async function setSubscription(entitledUntil: string | null) {
      await asAdmin(
        `insert into public.billing_purchases (user_id, platform, kind, product_id, store_ref, entitled_until, auto_renew)
         values ($1, 'ios', 'subscription', 'ijilog_plus_monthly', 'otx_erin', $2, true)
         on conflict (platform, store_ref) do update set entitled_until = excluded.entitled_until`,
        [erin, entitledUntil],
      );
    }
    async function planStatus() {
      return asUser(erin, async (c) => (await c.query(`select public.plan_status() as s`)).rows[0].s);
    }

    beforeAll(async () => {
      await asAdmin(`insert into auth.users (id) values ($1)`, [erin]);
      await setSubscription(new Date(Date.now() + 86400000).toISOString());
      for (const name of ['1台目', '2台目', '3台目']) {
        const r = await asAdmin(
          `insert into public.vehicles (user_id, name, annual_km_estimate, oil_interval_km, created_at)
           values ($1, $2, 5000, 5000, now() - make_interval(mins => $3)) returning id`,
          [erin, name, 10 - vehicles.length],
        );
        vehicles.push(r.rows[0].id);
      }
    });

    afterAll(async () => {
      await asAdmin(`delete from auth.users where id = $1`, [erin]);
    });

    it('購入の記録は本人だけが読め、利用者は書き込めない', async () => {
      await asUser(erin, async (c) => {
        const r = await c.query(`select store_ref from public.billing_purchases`);
        expect(r.rows.map((x) => x.store_ref)).toEqual(['otx_erin']);
        await expectFail(c, () =>
          c.query(
            `insert into public.billing_purchases (user_id, platform, kind, product_id, store_ref, entitled_until)
             values ($1, 'android', 'subscription', 'x', 'tok', now() + interval '1 year')`,
            [erin],
          ),
          /permission denied/,
        );
        await expectFail(c, () => c.query(`update public.billing_purchases set entitled_until = now() + interval '1 year'`), /permission denied/);
        await expectFail(c, () => c.query(`select public.apply_plan_restore($1)`, [erin]), /permission denied/);
        await expectFail(c, () => c.query(`select * from public.vehicles_in_service`), /permission denied/);
      });
      await asUser(alice, async (c) => {
        const r = await c.query(`select count(*)::int as n from public.billing_purchases`);
        expect(r.rows[0].n).toBe(0);
      });
    });

    it('使える定期購入がある間は複数台プラン。期限を過ぎると無料プランに戻り、残す1台を選ぶまで追加できない', async () => {
      let s = await planStatus();
      expect(s).toMatchObject({ plan: 'plus', vehicleLimit: 5, visibleCount: 3, mustChooseVehicle: false });
      expect(s.subscription).toMatchObject({ platform: 'ios', autoRenew: true, active: true });

      await setSubscription(new Date(Date.now() - 1000).toISOString());
      s = await planStatus();
      expect(s).toMatchObject({ plan: 'free', vehicleLimit: 1, visibleCount: 3, mustChooseVehicle: true });
      expect(s.subscription.active).toBe(false);
      await asUser(erin, async (c) => {
        await expectFail(c, () =>
          c.query(`insert into public.vehicles (name, annual_km_estimate, oil_interval_km) values ('4台目', 5000, 5000)`),
          /vehicle_limit_reached/,
        );
      });
      // 選ぶまでは、登録の古い1台だけをお知らせ・Ledra 連携の対象にする
      const inService = await asAdmin(`select id from public.vehicles_in_service where user_id = $1`, [erin]);
      expect(inService.rows.map((r) => r.id)).toEqual([vehicles[0]]);
    });

    it('残す1台を選ぶと、ほかは休止になる。休止中のクルマには書き込めず、休止の状態も自分では変えられない', async () => {
      await asUser(erin, async (c) => {
        await expectFail(c, () => c.query(`select public.keep_vehicle($1)`, [bobVehicle]), /vehicle_not_found/);
        await expectFail(c, () => c.query(`update public.vehicles set plan_suspended_at = now() where id = $1`, [vehicles[0]]), /suspend_via_server/);
      });
      await asUser(erin, async (c) => {
        const r = await c.query(`select public.keep_vehicle($1) as n`, [vehicles[1]]);
        expect(r.rows[0].n).toBe(2);
        await c.query('commit');
      });

      const s = await planStatus();
      expect(s).toMatchObject({ plan: 'free', visibleCount: 1, mustChooseVehicle: false, suspendedRestorable: 2, suspendedNeedsFee: 0 });
      const inService = await asAdmin(`select id from public.vehicles_in_service where user_id = $1`, [erin]);
      expect(inService.rows.map((r) => r.id)).toEqual([vehicles[1]]);

      await asUser(erin, async (c) => {
        await expectFail(c, () => c.query(`update public.vehicles set name = 'x' where id = $1`, [vehicles[0]]), /vehicle_suspended/);
        await expectFail(c, () => c.query(`update public.vehicles set plan_suspended_at = null where id = $1`, [vehicles[0]]), /vehicle_suspended/);
        await expectFail(c, () => c.query(`delete from public.vehicles where id = $1`, [vehicles[0]]), /vehicle_suspended/);
        await expectFail(c, () =>
          c.query(`insert into public.expenses (vehicle_id, spent_on, category, amount_yen) values ($1, '2026-10-02', 'fuel', 100)`, [vehicles[0]]),
          /vehicle_suspended/,
        );
        await expectFail(c, () => c.query(`select public.register_deadline($1, 'shaken', '2027-01-01')`, [vehicles[2]]), /vehicle_suspended/);
        // 残したクルマには書ける
        await c.query(`insert into public.expenses (vehicle_id, spent_on, category, amount_yen) values ($1, '2026-10-02', 'fuel', 100)`, [vehicles[1]]);
        // 無料プランで上限に達していれば、休止を戻せない
        const r = await c.query(`select public.restore_suspended_vehicles() as n`);
        expect(r.rows[0].n).toBe(0);
      });
    });

    it('再契約すると、休止から90日以内のクルマは戻る。90日を過ぎたものは事務手数料を払うまで戻らない', async () => {
      // 1台は休止から91日たったことにする
      await asAdmin(`update public.vehicles set plan_suspended_at = now() - interval '91 days' where id = $1`, [vehicles[2]]);
      let s = await planStatus();
      expect(s).toMatchObject({ suspendedRestorable: 1, suspendedNeedsFee: 1, hasUnusedRestoreFee: false });

      await setSubscription(new Date(Date.now() + 30 * 86400000).toISOString());
      let restored = await asAdmin(`select public.apply_plan_restore($1) as n`, [erin]);
      expect(restored.rows[0].n).toBe(1);
      s = await planStatus();
      expect(s).toMatchObject({ plan: 'plus', visibleCount: 2, suspendedRestorable: 0, suspendedNeedsFee: 1 });

      // 事務手数料の購入（サーバーが確認したことにする）
      await asAdmin(
        `insert into public.billing_purchases (user_id, platform, kind, product_id, store_ref)
         values ($1, 'ios', 'restore_fee', 'ijilog_restore_fee', 'tx_fee_erin')`,
        [erin],
      );
      expect((await planStatus()).hasUnusedRestoreFee).toBe(true);
      restored = await asUser(erin, async (c) => {
        const r = await c.query(`select public.restore_suspended_vehicles() as n`);
        await c.query('commit');
        return r;
      });
      expect(restored.rows[0].n).toBe(1);
      s = await planStatus();
      expect(s).toMatchObject({ visibleCount: 3, suspendedNeedsFee: 0, hasUnusedRestoreFee: false });
      const fee = await asAdmin(`select used_at from public.billing_purchases where store_ref = 'tx_fee_erin'`);
      expect(fee.rows[0].used_at).not.toBeNull();
      const inService = await asAdmin(`select count(*)::int as n from public.vehicles_in_service where user_id = $1`, [erin]);
      expect(inService.rows[0].n).toBe(3);
    });

    it('返金された定期購入では複数台プランにならない', async () => {
      await asAdmin(`update public.billing_purchases set revoked_at = now() where store_ref = 'otx_erin'`);
      expect((await planStatus()).plan).toBe('free');
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
    await asAdmin(`insert into public.wear_checks (vehicle_id, user_id, kind, performed_on) values ($1, $2, 'tire', '2026-10-01')`, [v.rows[0].id, carol]);
    await asAdmin(
      `insert into public.input_sessions (user_id, vehicle_id, kind, mode, method, outcome, opened_at, finished_at) values ($1, $2, 'tire', 'new', 'manual', 'abandoned', now(), now())`,
      [carol, v.rows[0].id],
    );
    await asAdmin(`delete from auth.users where id = $1`, [carol]);
    for (const t of ['profiles', 'vehicles', 'oil_changes', 'expenses', 'wear_checks', 'input_sessions']) {
      const col = t === 'profiles' ? 'id' : 'user_id';
      const r = await asAdmin(`select count(*)::int as n from public.${t} where ${col} = $1`, [carol]);
      expect(r.rows[0].n, t).toBe(0);
    }
  });
});
