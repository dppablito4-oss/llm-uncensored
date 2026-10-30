import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const db = new PGlite();
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222",
  model = "z-ai/glm-5.3-flash-uncensored";
let cid = "",
  preset = "";
async function asUser<T>(uid: string, sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
    return tx.query<T>(sql, params);
  });
}
beforeAll(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated;alter default privileges in schema public grant all on tables to service_role;alter default privileges in schema public grant all on sequences to service_role;`,
  );
  await db.exec(
    "create table public.other_app_records(id integer primary key);grant select on public.other_app_records to anon;create table public.profiles(id integer primary key);insert into public.profiles values(123);",
  );
  await db.exec(
    readFileSync("supabase/migrations/202610300001_initial.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/202610300002_nanogpt_models.sql", "utf8"),
  );
  await db.exec("set search_path=forma,public");
  await db.query("insert into auth.users values($1,$2),($3,$4)", [
    a,
    "a@example.com",
    b,
    "b@example.com",
  ]);
  await asUser(a, "select ensure_workspace()");
  await asUser(b, "select ensure_workspace()");
  await asUser(a, "select ensure_workspace()");
  preset = (
    await asUser<{ id: string }>(a, "select id from forma.presets limit 1")
  ).rows[0].id;
  cid = (
    await asUser<{ id: string }>(
      a,
      "insert into forma.conversations(user_id,title,model_id,preset_id) values($1,$2,$3,$4) returning id",
      [a, "Private A", model, preset],
    )
  ).rows[0].id;
}, 60000);
afterAll(() => db.close());
describe.sequential("Migración PostgreSQL real y aislamiento RLS", () => {
  it("conserva permisos de tablas de otras aplicaciones", async () => {
    const result = await db.query<{ allowed: boolean }>(
      "select has_table_privilege('anon','public.other_app_records','select') as allowed",
    );
    expect(result.rows[0].allowed).toBe(true);
    expect((await db.query("select id from public.profiles")).rows).toEqual([
      { id: 123 },
    ]);
  });
  it("SQL aislado crea solo una tabla sin cambiar triggers de Auth", async () => {
    const before = await db.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname='public' order by tablename",
    );
    const triggers = await db.query(
      "select oid from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal order by oid",
    );
    await db.exec(
      readFileSync("supabase/manual/create_connection_check.sql", "utf8"),
    );
    const after = await db.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname='public' order by tablename",
    );
    expect(
      after.rows.filter(
        (row) => !before.rows.some((old) => old.name === row.name),
      ),
    ).toEqual([{ name: "forma_connection_checks" }]);
    expect(
      (
        await db.query(
          "select oid from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal order by oid",
        )
      ).rows,
    ).toEqual(triggers.rows);
  });
  it("tabla aislada permite comprobar conexión sin exponer filas ajenas", async () => {
    const id = (
      await asUser<{ id: string }>(
        a,
        "insert into forma_connection_checks default values returning id",
      )
    ).rows[0].id;
    expect(
      (await asUser(a, "select * from forma_connection_checks")).rows,
    ).toHaveLength(1);
    expect(
      (await asUser(b, "select * from forma_connection_checks")).rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(
          b,
          "delete from forma_connection_checks where id=$1 returning id",
          [id],
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      asUser(b, "insert into forma_connection_checks(user_id) values($1)", [a]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        return tx.query("select * from forma_connection_checks");
      }),
    ).rejects.toThrow(/permission denied/);
    await asUser(a, "delete from forma_connection_checks where id=$1", [id]);
    expect(
      (await asUser(a, "select * from forma_connection_checks")).rows,
    ).toHaveLength(0);
  });
  it("crea perfil, límites y tres presets por usuario", async () => {
    expect((await asUser(a, "select * from profiles")).rows).toHaveLength(1);
    expect((await asUser(a, "select * from presets")).rows).toHaveLength(3);
    expect((await asUser(b, "select * from user_limits")).rows).toHaveLength(1);
  });
  it("B no puede leer, editar ni eliminar conversación de A", async () => {
    expect(
      (await asUser(b, "select * from conversations where id=$1", [cid])).rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(
          b,
          "update conversations set title='stolen' where id=$1 returning id",
          [cid],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(b, "delete from conversations where id=$1 returning id", [
          cid,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it("rechaza insertar suplantando user_id", async () => {
    await expect(
      asUser(b, "insert into conversations(user_id,model_id) values($1,$2)", [
        a,
        model,
      ]),
    ).rejects.toThrow(/row-level security/);
  });
  it("rechaza preset de otro dueño mediante FK compuesta", async () => {
    await expect(
      asUser(
        b,
        "insert into conversations(user_id,model_id,preset_id) values($1,$2,$3)",
        [b, model, preset],
      ),
    ).rejects.toThrow(/foreign key/);
  });
  it("CRUD real de presets con aislamiento", async () => {
    const id = (
      await asUser<{ id: string }>(
        a,
        "insert into presets(user_id,name,system_prompt,model_id) values($1,'Custom','Prompt',$2) returning id",
        [a, model],
      )
    ).rows[0].id;
    expect(
      (await asUser(b, "select * from presets where id=$1", [id])).rows,
    ).toHaveLength(0);
    await asUser(a, "update presets set name='Updated' where id=$1", [id]);
    expect(
      (
        await asUser<{ name: string }>(
          a,
          "select name from presets where id=$1",
          [id],
        )
      ).rows[0].name,
    ).toBe("Updated");
    await asUser(a, "delete from presets where id=$1", [id]);
    expect(
      (await asUser(a, "select * from presets where id=$1", [id])).rows,
    ).toHaveLength(0);
  });
  it("CRUD real de memorias con aislamiento", async () => {
    const id = (
      await asUser<{ id: string }>(
        a,
        "insert into memories(user_id,content) values($1,'remember me') returning id",
        [a],
      )
    ).rows[0].id;
    expect(
      (await asUser(b, "select * from memories where id=$1", [id])).rows,
    ).toHaveLength(0);
    await asUser(a, "update memories set enabled=false where id=$1", [id]);
    expect(
      (
        await asUser<{ enabled: boolean }>(
          a,
          "select enabled from memories where id=$1",
          [id],
        )
      ).rows[0].enabled,
    ).toBe(false);
    await expect(
      asUser(b, "insert into memories(user_id,content) values($1,'bad')", [a]),
    ).rejects.toThrow();
    await asUser(a, "delete from memories where id=$1", [id]);
    expect((await asUser(a, "select * from memories")).rows).toHaveLength(0);
  });
  it("cliente no puede escribir mensajes, consumo, límites o modelos", async () => {
    for (const sql of [
      "insert into messages(user_id,conversation_id,role,content) values($1,$2,'assistant','fake')",
      "update user_limits set daily_tokens=999999 where user_id=$1",
      "delete from usage_events where user_id=$1",
      "update models set enabled=false where id=$1",
    ]) {
      await expect(
        asUser(a, sql, sql.includes("$2") ? [a, cid] : [a]),
      ).rejects.toThrow(/permission denied/);
    }
  });
  it("cliente no puede llamar funciones privilegiadas", async () => {
    await expect(
      asUser(
        a,
        "select begin_generation($1,$2,gen_random_uuid(),'hi',$3,null,'send',null,100)",
        [a, cid, model],
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("reserva, persiste y evita duplicados sin fiarse del historial cliente", async () => {
    const rid = crypto.randomUUID();
    const params = [a, cid, rid, "hola", model, null, "send", null, 100];
    const ev = (
      await db.query<{ id: string }>(
        "select begin_generation($1,$2,$3,$4,$5,$6,$7,$8,$9) as id",
        params,
      )
    ).rows[0].id;
    expect((await asUser(b, "select * from messages")).rows).toHaveLength(0);
    await expect(
      db.query("select begin_generation($1,$2,$3,$4,$5,$6,$7,$8,$9)", params),
    ).rejects.toThrow(/DUPLICATE/);
    await db.query(
      "select finish_generation($1,'hola de vuelta','complete',10,5,.001,null)",
      [ev],
    );
    expect((await asUser(a, "select * from messages")).rows).toHaveLength(2);
    expect((await asUser(b, "select * from usage_events")).rows).toHaveLength(
      0,
    );
  });
  it("rechaza propiedad falsa y modelo no autorizado", async () => {
    await expect(
      db.query(
        "select begin_generation($1,$2,gen_random_uuid(),'hi',$3,null,'send',null,100)",
        [b, cid, model],
      ),
    ).rejects.toThrow(/NOT_FOUND/);
    await expect(
      db.query(
        "select begin_generation($1,$2,gen_random_uuid(),'hi','untrusted',null,'send',null,100)",
        [a, cid],
      ),
    ).rejects.toThrow(/MODEL_NOT_ALLOWED/);
  });
  it("cancelación persiste parcial y finish es idempotente", async () => {
    const ev = (
      await db.query<{ id: string }>(
        "select begin_generation($1,$2,gen_random_uuid(),'next',$3,null,'send',null,100) as id",
        [a, cid, model],
      )
    ).rows[0].id;
    await db.query(
      "select finish_generation($1,'parcial','partial',20,2,null,'CANCELLED')",
      [ev],
    );
    await db.query(
      "select finish_generation($1,'duplicado','complete',20,2,null,null)",
      [ev],
    );
    const rows = (
      await asUser<{ content: string; status: string }>(
        a,
        "select content,status from messages where role='assistant' order by seq desc",
      )
    ).rows;
    expect(rows[0]).toEqual({ content: "parcial", status: "partial" });
    expect(rows.some((r) => r.content === "duplicado")).toBe(false);
  });
  it("edita descartando turnos posteriores y regenera conservando usuario", async () => {
    const target = (
      await asUser<{ id: string }>(
        a,
        "select id from messages where role='user' order by seq limit 1",
      )
    ).rows[0].id;
    const ev = (
      await db.query<{ id: string }>(
        "select begin_generation($1,$2,gen_random_uuid(),'edited',$3,null,'edit',$4,100) as id",
        [a, cid, model, target],
      )
    ).rows[0].id;
    expect((await asUser(a, "select * from messages")).rows).toHaveLength(1);
    await db.query(
      "select finish_generation($1,'answer','complete',2,2,null,null)",
      [ev],
    );
    const nextTarget = (
      await asUser<{ id: string }>(
        a,
        "select id from messages where role='user'",
      )
    ).rows[0].id;
    const regen = (
      await db.query<{ id: string }>(
        "select begin_generation($1,$2,gen_random_uuid(),'',$3,null,'regenerate',$4,100) as id",
        [a, cid, model, nextTarget],
      )
    ).rows[0].id;
    expect((await asUser(a, "select * from messages")).rows).toHaveLength(1);
    await db.query(
      "select finish_generation($1,'new answer','complete',2,2,null,null)",
      [regen],
    );
  });
  it("impone límite por minuto y cuota de tokens desde servidor", async () => {
    await db.query(
      "update user_limits set requests_per_minute=1 where user_id=$1",
      [a],
    );
    await expect(
      db.query(
        "select begin_generation($1,$2,gen_random_uuid(),'hi',$3,null,'send',null,100)",
        [a, cid, model],
      ),
    ).rejects.toThrow(/RATE_LIMIT/);
    await db.query(
      "update user_limits set requests_per_minute=100,daily_tokens=1 where user_id=$1",
      [a],
    );
    await expect(
      db.query(
        "select begin_generation($1,$2,gen_random_uuid(),'hi',$3,null,'send',null,100)",
        [a, cid, model],
      ),
    ).rejects.toThrow(/TOKEN_LIMIT/);
  });
});
