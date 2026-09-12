import type pg from "pg";

const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Build a large derived snapshot without random per-row index updates. The caller
 * owns the trend advisory lock and transaction; even the final swap rolls back. */
export async function rebuildTrendSnapshot(
  client: pg.Client,
  startDate: string,
  endDate: string,
  onProgress?: (message: string) => void
): Promise<number> {
  await client.query("set local lock_timeout = '5s'");
  // Freeze schema changes while leaving ordinary readers available throughout the build.
  await client.query("lock table theme_trends in share update exclusive mode");
  const metadata = await client.query<{
    schema: string; pid: number; supported: boolean;
  }>(`select n.nspname as schema, pg_backend_pid() as pid,
    c.relkind = 'r' and c.relowner = (select oid from pg_roles where rolname = current_user)
    and c.relacl is null and not c.relrowsecurity and c.relreplident = 'd'
    and not exists (select 1 from pg_trigger where tgrelid = c.oid and not tgisinternal)
    and not exists (select 1 from pg_constraint where confrelid = c.oid and conrelid <> c.oid)
    and not exists (select 1 from pg_depend where refobjid = c.oid and classid = 'pg_rewrite'::regclass)
    and not exists (select 1 from pg_publication_tables where schemaname = n.nspname and tablename = c.relname)
    as supported
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.oid = 'theme_trends'::regclass`);
  const meta = metadata.rows[0];
  if (!meta?.supported) {
    throw new Error("Trend snapshot replacement requires an owner-managed table without custom grants, views, inbound foreign keys, triggers, row security or replication. Keep incremental publication for this schema.");
  }
  const schema = identifier(meta.schema);
  const current = `${schema}.theme_trends`;
  const nextName = `theme_trends_next_${meta.pid}`;
  const oldName = `theme_trends_old_${meta.pid}`;
  const next = `${schema}.${identifier(nextName)}`;
  const constraints = await client.query<{ name: string; definition: string }>(
    `select conname as name, pg_get_constraintdef(oid) as definition
     from pg_constraint where conrelid = 'theme_trends'::regclass
       and contype in ('p', 'u', 'f', 'x')
     order by case contype when 'p' then 0 when 'u' then 1 else 2 end, conname`
  );
  const indexes = await client.query<{ name: string; unique: boolean; suffix: string }>(
    `select ci.relname as name, i.indisunique as unique,
            substring(pg_get_indexdef(i.indexrelid) from ' USING .*$') as suffix
     from pg_index i join pg_class ci on ci.oid = i.indexrelid
     where i.indrelid = 'theme_trends'::regclass
       and not exists (select 1 from pg_constraint where conindid = i.indexrelid)
     order by ci.relname`
  );
  await client.query(`create table ${next} (like ${current} including all excluding indexes)`);
  // Default privileges must not silently grant access beyond the current table.
  const grants = await client.query<{ customized: boolean }>(
    "select relacl is not null as customized from pg_class where oid = $1::regclass", [next]
  );
  if (grants.rows[0]?.customized) throw new Error("Trend snapshot replacement cannot inherit custom default grants.");
  await client.query(`alter table ${next} add column publication_changed boolean`);
  onProgress?.("building replacement trend snapshot");
  const inserted = await client.query<{ changed: string }>(`with copied as (
    insert into ${next} (
      id, theme_id, trend_window, date, intensity, baseline_mean, baseline_stddev,
      z_score, percentile_rank, source_mix, created_at, publication_changed
    )
    select incoming.*, coalesce(old.created_at, now()),
      old.id is distinct from incoming.id or
      (old.intensity, old.baseline_mean, old.baseline_stddev, old.z_score,
       old.percentile_rank, old.source_mix) is distinct from
      (incoming.intensity, incoming.baseline_mean, incoming.baseline_stddev,
       incoming.z_score, incoming.percentile_rank, incoming.source_mix)
    from staged_theme_trends incoming
    left join ${current} old using (theme_id, trend_window, date)
    union all
    select old.*, false from ${current} old
    where old.date < $1::date or old.date > $2::date
    returning publication_changed
  ) select count(*) filter (where publication_changed)::text as changed from copied`, [startDate, endDate]);
  await client.query(`alter table ${next} drop column publication_changed`);
  onProgress?.("loaded replacement trend snapshot; building constraints and indexes");
  const renames: Array<{ temporary: string; original: string; constraint: boolean }> = [];
  for (const [index, constraint] of constraints.rows.entries()) {
    const name = `trend_snapshot_${meta.pid}_c${index}`;
    await client.query(`alter table ${next} add constraint ${identifier(name)} ${constraint.definition}`);
    renames.push({ temporary: name, original: constraint.name, constraint: true });
    onProgress?.(`built trend constraint ${constraint.name}`);
  }
  for (const [index, definition] of indexes.rows.entries()) {
    if (!definition.suffix) throw new Error(`Unsupported trend index ${definition.name}`);
    const name = `trend_snapshot_${meta.pid}_i${index}`;
    await client.query(`create ${definition.unique ? "unique " : ""}index ${identifier(name)} on ${next}${definition.suffix}`);
    renames.push({ temporary: name, original: definition.name, constraint: false });
    onProgress?.(`built trend index ${definition.name}`);
  }
  await client.query(`analyze ${next}`);
  onProgress?.("replacement trend snapshot ready; switching publication");
  // The only reader-blocking part is the short catalog swap. RESTRICT deliberately
  // refuses to break a dependency added since the checks above; never use CASCADE.
  await client.query(`lock table ${current} in access exclusive mode`);
  await client.query(`alter table ${current} rename to ${identifier(oldName)}`);
  await client.query(`alter table ${next} rename to theme_trends`);
  await client.query(`drop table ${schema}.${identifier(oldName)} restrict`);
  for (const rename of renames) {
    await client.query(rename.constraint
      ? `alter table ${current} rename constraint ${identifier(rename.temporary)} to ${identifier(rename.original)}`
      : `alter index ${schema}.${identifier(rename.temporary)} rename to ${identifier(rename.original)}`);
  }
  onProgress?.("replacement trend snapshot switched");
  return Number(inserted.rows[0].changed);
}
