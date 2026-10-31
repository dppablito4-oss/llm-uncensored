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
  await db.exec(
    "create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select on storage.objects to authenticated;",
  );
  await db.exec(
    readFileSync("supabase/migrations/202610300003_images.sql", "utf8"),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261031003417_chat_quota_accounting.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261031004538_image_gallery_management.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261031004954_chat_response_budget.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync("supabase/migrations/20261031021036_qwen_image_3.sql", "utf8"),
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
  it("reserva imágenes en servidor y aísla registros y archivos por dueño", async () => {
    const request = crypto.randomUUID();
    const args = [
      a,
      request,
      "nsfw-gen-illustrious",
      "A mountain",
      "512x512",
      12,
      7.5,
      null,
    ];
    const sql = "select begin_image_generation($1,$2,$3,$4,$5,$6,$7,$8) as id";
    const imageId = (await db.query<{ id: string }>(sql, args)).rows[0].id;
    expect(
      (await asUser(a, "select id from image_generations")).rows,
    ).toHaveLength(1);
    expect(
      (await asUser(b, "select id from image_generations")).rows,
    ).toHaveLength(0);
    await expect(asUser(a, sql, args)).rejects.toThrow(/permission denied/);
    await expect(
      asUser(a, "update image_generations set status='complete'"),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query(sql, args)).rejects.toThrow(/DUPLICATE_REQUEST/);
    await expect(
      db.query(sql, [a, crypto.randomUUID(), ...args.slice(2)]),
    ).rejects.toThrow(/GENERATION_RUNNING/);
    await db.query(
      "insert into storage.objects(bucket_id,name) values('forma-images',$1)",
      [a + "/" + imageId + ".png"],
    );
    expect(
      (await asUser(a, "select name from storage.objects")).rows,
    ).toHaveLength(1);
    expect(
      (await asUser(b, "select name from storage.objects")).rows,
    ).toHaveLength(0);
    await db.query(
      "update image_generations set status='complete' where id=$1",
      [imageId],
    );
    await db.query("update user_limits set daily_images=1 where user_id=$1", [
      a,
    ]);
    await db.query(
      "update image_generations set deleted_at=now(),object_path=null,prompt='[Imagen eliminada]' where id=$1",
      [imageId],
    );
    await expect(
      db.query(sql, [a, crypto.randomUUID(), ...args.slice(2)]),
    ).rejects.toThrow(/DAILY_LIMIT/);
  });
  it("no autoriza IDs ni parámetros de imagen fuera de la lista", async () => {
    const sql =
      "select begin_image_generation($1,gen_random_uuid(),$2,$3,$4,$5,$6,null)";
    await expect(
      db.query(sql, [b, "other-model", "A tree", "512x512", 12, 7.5]),
    ).rejects.toThrow(/MODEL_NOT_ALLOWED/);
    await expect(
      db.query(sql, [b, "hassaku-hentai", "A tree", "9000x9000", 12, 7.5]),
    ).rejects.toThrow(/INVALID_SIZE/);
    await expect(
      db.query(sql, [b, "hassaku-hentai", "A tree", "512x512", 200, 7.5]),
    ).rejects.toThrow(/INVALID_PARAMETERS/);
  });
  it("reserva Qwen en 2K y proporción validada con aislamiento por usuario", async () => {
    const sql =
      "select begin_image_generation($1,gen_random_uuid(),'qwen-image-3-uncensored',$2,$3,$4,$5,$6,$7) as id";
    for (const args of [
      [b, "A cat", "1024x1024", null, null, null, "1:1"],
      [b, "A cat", "2k", 12, 7.5, null, "1:1"],
      [b, "A cat", "2k", null, null, null, "7:3"],
      [b, "x".repeat(10001), "2k", null, null, null, "1:1"],
    ])
      await expect(db.query(sql, args)).rejects.toThrow(/INVALID_/);
    const args = [b, "x".repeat(10000), "2k", null, null, null, "16:9"];
    await expect(asUser(b, sql, args)).rejects.toThrow(/permission denied/);
    const result = await db.query<{ id: string }>(sql, args),
      id = result.rows[0].id;
    const rows = (
      await asUser<{
        size: string;
        aspect_ratio: string;
        steps: null;
        cfg_scale: null;
        seed: null;
      }>(
        b,
        "select size,aspect_ratio,steps,cfg_scale,seed from image_generations where id=$1",
        [id],
      )
    ).rows;
    expect(rows[0]).toEqual({
      size: "2k",
      aspect_ratio: "16:9",
      steps: null,
      cfg_scale: null,
      seed: null,
    });
    expect(
      (await asUser(a, "select id from image_generations where id=$1", [id]))
        .rows,
    ).toHaveLength(0);
    await db.query(
      "update image_generations set status='complete' where id=$1",
      [id],
    );
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
  it("mantiene una conversación de 12 turnos cobrando consumo confirmado en vez de máximos", async () => {
    await db.query(
      "update user_limits set requests_per_minute=100,daily_requests=100,daily_tokens=1000 where user_id=$1",
      [b],
    );
    const conversation = (
      await asUser<{ id: string }>(
        b,
        "insert into conversations(user_id,model_id) values($1,$2) returning id",
        [b, model],
      )
    ).rows[0].id;
    for (let turn = 0; turn < 12; turn++) {
      const event = (
        await db.query<{ id: string }>(
          "select begin_generation($1,$2,gen_random_uuid(),'hola',$3,null,'send',null,200) as id",
          [b, conversation, model],
        )
      ).rows[0].id;
      await db.query("select prepare_generation($1,30,200)", [event]);
      await db.query(
        "select finish_generation($1,'respuesta','complete',15,5,null,null,true,true)",
        [event],
      );
    }
    const rows = (
      await asUser<{ content: string }>(
        b,
        "select content from messages where conversation_id=$1",
        [conversation],
      )
    ).rows;
    expect(rows).toHaveLength(24);
    const usage = (
      await asUser<{
        summary: {
          tokens_today: number;
          requests_today: number;
          tokens_total: number;
        };
      }>(b, "select usage_summary() as summary")
    ).rows[0].summary;
    expect(usage).toMatchObject({
      tokens_today: 240,
      requests_today: 12,
      tokens_total: 240,
    });
    await expect(
      asUser(b, "select prepare_generation(gen_random_uuid(),10,100)"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(
        b,
        "select finish_generation(gen_random_uuid(),'x','complete',0,0,null,null,true,false)",
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("libera intentos previos al proveedor y conserva reservas con uso desconocido", async () => {
    const conversation = (
      await asUser<{ id: string }>(
        b,
        "insert into conversations(user_id,model_id) values($1,$2) returning id",
        [b, model],
      )
    ).rows[0].id;
    const begin = async () =>
      (
        await db.query<{ id: string }>(
          "select begin_generation($1,$2,gen_random_uuid(),'hola',$3,null,'send',null,200) as id",
          [b, conversation, model],
        )
      ).rows[0].id;
    const noProvider = await begin();
    // Reserving beyond the remaining quota must fail before an API call.
    await expect(
      db.query("select prepare_generation($1,900,200)", [noProvider]),
    ).rejects.toThrow(/TOKEN_LIMIT/);
    await db.query(
      "select finish_generation($1,'','error',0,0,null,'TOKEN_LIMIT',false,false)",
      [noProvider],
    );
    const unknown = await begin();
    await db.query("select prepare_generation($1,30,200)", [unknown]);
    await db.query(
      "select finish_generation($1,'parcial','partial',30,7,null,'CANCELLED',false,true)",
      [unknown],
    );
    expect(
      (
        await db.query<{ quota_tokens: number | null }>(
          "select quota_tokens from usage_events where id=$1",
          [unknown],
        )
      ).rows[0].quota_tokens,
    ).toBeNull();
    expect(
      (
        await db.query<{ quota_tokens: number }>(
          "select quota_tokens from usage_events where id=$1",
          [noProvider],
        )
      ).rows[0].quota_tokens,
    ).toBe(0);
    const usage = (
      await asUser<{
        summary: { tokens_today: number; reserved_today: number };
      }>(b, "select usage_summary() as summary")
    ).rows[0].summary;
    expect(usage).toMatchObject({ tokens_today: 470, reserved_today: 230 });
    // Finalization cannot be replayed to erase consumption or append output.
    await db.query(
      "select finish_generation($1,'duplicate','complete',0,0,null,null,true,false)",
      [unknown],
    );
    expect(
      (
        await asUser<{ summary: { tokens_today: number } }>(
          b,
          "select usage_summary() as summary",
        )
      ).rows[0].summary.tokens_today,
    ).toBe(470);
  });
});
