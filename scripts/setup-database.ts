/**
 * One-command database setup — the weddings app's script, pointed at the `pay`
 * schema and its own tracker table.
 *
 *   npm run setup:db              # show what would happen, change nothing
 *   npm run setup:db -- --commit  # apply the migrations that are not yet in pay._migrations
 *
 * Applies supabase/migrations/*.sql in order against DATABASE_URL, tracking what
 * has already run (by content hash) in pay._migrations, so re-running is safe —
 * and so migrations applied by hand through the dashboard SQL editor (with
 * their tracker row) are skipped here.
 *
 * Optionally creates the first admin login:
 *   npm run setup:db -- --commit --admin-email david@mvrkhq.com --admin-name "David"
 * Forgotten admin password: add --reset-password for a new one-time password.
 * (needs SUPABASE_SERVICE_ROLE_KEY; the email must be on a team domain.)
 */

import { config } from 'dotenv'
import { Client } from 'pg'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import path from 'node:path'

config({ path: '.env.local' })

const args = process.argv.slice(2)
const commit = args.includes('--commit')
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : undefined
}

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations')
const rule = (s = '─') => console.log(s.repeat(78))

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.startsWith('placeholder')) {
    console.error(`\n  Missing ${name} in .env.local\n`)
    process.exit(1)
  }
  return value
}

async function applyMigrations() {
  if (!process.env.DATABASE_URL) {
    console.log('\n  DATABASE_URL is not set — skipping migrations.')
    console.log('  (Apply them through the Supabase SQL editor, or set it to apply from here.)')
    return 0
  }
  const client = new Client({ connectionString: requireEnv('DATABASE_URL'), ssl: { rejectUnauthorized: false } })
  await client.connect()

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  await client.query('create schema if not exists pay')
  await client.query(`
    create table if not exists pay._migrations (
      name text primary key,
      sha256 text not null,
      applied_at timestamptz not null default now()
    )
  `)
  const { rows: done } = await client.query<{ name: string; sha256: string }>('select name, sha256 from pay._migrations')
  const applied = new Map(done.map((r) => [r.name, r.sha256]))

  console.log(`\n  ${files.length} migration files, ${applied.size} already applied\n`)

  let ran = 0
  for (const name of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')
    const sha = createHash('sha256').update(sql).digest('hex')
    const previous = applied.get(name)
    if (previous === sha) {
      console.log(`  skip   ${name}  (unchanged)`)
      continue
    }
    if (previous && previous !== sha) {
      console.log(`  WARN   ${name}  already applied, but the file has changed since.`)
      console.log('         Not re-running it — write a new migration instead.')
      continue
    }
    if (!commit) {
      console.log(`  would  ${name}`)
      continue
    }
    try {
      await client.query('begin')
      await client.query(sql)
      await client.query('insert into pay._migrations (name, sha256) values ($1, $2)', [name, sha])
      await client.query('commit')
      console.log(`  ok     ${name}`)
      ran++
    } catch (e) {
      await client.query('rollback')
      console.error(`\n  FAILED ${name}\n  ${(e as Error).message}\n`)
      await client.end()
      process.exit(1)
    }
  }
  await client.end()
  return ran
}

class UnusedRealtimeTransport {
  constructor() {
    throw new Error('database setup does not use Supabase realtime')
  }
}

async function createAdmin(email: string, fullName: string, resetPassword = false) {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: UnusedRealtimeTransport as unknown as never },
  })
  const pay = supabase.schema('pay')

  const { data: existing } = await supabase.auth.admin.listUsers()
  const already = existing?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())

  let userId: string
  let password: string | null = null
  if (already) {
    userId = already.id
    console.log(`\n  Auth user ${email} already exists (it may be a weddings login); reusing it.`)
    if (resetPassword) {
      // Break-glass for a forgotten admin password: a fresh one-time password,
      // shown once here, to be changed at the next sign-in.
      password = randomBytes(12).toString('base64url')
      const { error } = await supabase.auth.admin.updateUserById(userId, { password })
      if (error) {
        console.error(`\n  Could not reset the password: ${error.message}`)
        process.exit(1)
      }
    }
  } else {
    password = randomBytes(12).toString('base64url')
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, app: 'mvrk-pay' },
    })
    if (error || !data.user) {
      console.error(`\n  Could not create the admin login: ${error?.message}`)
      process.exit(1)
    }
    userId = data.user.id
  }

  const { error: profileError } = await pay
    .from('profiles')
    .upsert({ id: userId, email: email.toLowerCase(), full_name: fullName, role: 'admin', active: true, must_change_password: !!password }, { onConflict: 'id' })
  if (profileError) {
    console.error(`\n  Could not write the admin profile: ${profileError.message}`)
    process.exit(1)
  }

  rule()
  console.log(`  Admin login: ${email}`)
  if (password) {
    console.log(`  Password:    ${password}   (shown once — it must be changed at first sign-in)`)
  } else {
    console.log('  Password:    unchanged (the existing Auth password works)')
  }
  rule()
}

async function main() {
  rule('═')
  console.log(`  MVRK Pay — database setup ${commit ? '(COMMIT)' : '(dry run)'}`)
  rule('═')
  const ran = await applyMigrations()
  if (commit) console.log(`\n  ${ran} migration${ran === 1 ? '' : 's'} applied.`)

  const adminEmail = flag('admin-email')
  if (adminEmail) {
    if (!commit) console.log('\n  (Admin login is only created with --commit.)')
    else await createAdmin(adminEmail, flag('admin-name') ?? 'Admin', args.includes('--reset-password'))
  }
  console.log()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
