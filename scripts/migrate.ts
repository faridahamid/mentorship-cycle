import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import postgres from "postgres";

function loadEnv() {
  const envFiles = [".env.local", ".env", ".env.example"];
  for (const file of envFiles) {
    const p = path.resolve(process.cwd(), file);
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
          if (key && !process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

function prompt(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

function getProjectRef(supabaseUrl?: string): string | null {
  if (!supabaseUrl) return null;
  try {
    const u = new URL(supabaseUrl);
    return u.hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function printHelp(projectRef: string | null) {
  const ref = projectRef || "rcedgujohuxsmtekhppd";
  console.log(`
NASA Space Apps Cairo - Database Migration Runner

USAGE:
  npm run migrate [options] [connection_string]

OPTIONS:
  -d, --db <url>       PostgreSQL connection URI
  -f, --file <path>    Run a specific SQL file instead of all migrations
  -h, --help           Show this help message

EXAMPLES:
  # Run all pending migrations using DATABASE_URL from .env.local
  npm run migrate

  # Pass IPv4 Pooler connection URI (recommended for networks without IPv6)
  npm run migrate "postgresql://postgres.${ref}:[PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"

  # Apply a specific SQL file
  npm run migrate --file supabase/schema_all.sql
`);
}

async function run() {
  loadEnv();

  const args = process.argv.slice(2);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rcedgujohuxsmtekhppd.supabase.co";
  const projectRef = getProjectRef(supabaseUrl);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp(projectRef);
    process.exit(0);
  }

  // 1. Determine connection string
  let dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL;
  let customFile: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--db" || arg === "-d") {
      dbUrl = args[++i];
    } else if (arg === "--file" || arg === "-f") {
      customFile = args[++i];
    } else if (arg.startsWith("postgres://") || arg.startsWith("postgresql://")) {
      dbUrl = arg;
    }
  }

  // If no DATABASE_URL, prompt interactively if TTY
  if (!dbUrl) {
    if (process.stdin.isTTY) {
      console.log("\n========================================================");
      console.log("  NASA Space Apps Cairo - Supabase Database Migrations  ");
      console.log("========================================================\n");
      console.log(`Supabase Project: ${projectRef || supabaseUrl}`);
      console.log("No DATABASE_URL found in .env.local\n");

      const input = await prompt(
        "Enter Supabase Database Password OR full Connection String:\n> "
      );

      if (input.startsWith("postgres://") || input.startsWith("postgresql://")) {
        dbUrl = input;
      } else if (input && projectRef) {
        dbUrl = `postgresql://postgres:${encodeURIComponent(input)}@db.${projectRef}.supabase.co:5432/postgres`;
      }

      if (dbUrl) {
        const saveAns = await prompt("\nSave this DATABASE_URL to .env.local? (y/N): ");
        if (saveAns.toLowerCase() === "y" || saveAns.toLowerCase() === "yes") {
          const envLocalPath = path.resolve(process.cwd(), ".env.local");
          fs.appendFileSync(envLocalPath, `\nDATABASE_URL=${dbUrl}\n`);
          console.log("✓ Saved DATABASE_URL to .env.local");
        }
      }
    }
  }

  if (!dbUrl) {
    printHelp(projectRef);
    process.exit(1);
  }

  console.log("\nConnecting to database...");

  // Initialize postgres client with SSL
  let sql = postgres(dbUrl, {
    ssl: { rejectUnauthorized: false },
    max: 1,
    connect_timeout: 10,
  });

  try {
    let test;
    try {
      [test] = await sql`SELECT current_database(), current_user`;
    } catch (connErr: unknown) {
      const errObj = connErr as { code?: string; message?: string };
      if (
        (errObj.code === "ENETUNREACH" || errObj.message?.includes("ENETUNREACH")) &&
        projectRef &&
        dbUrl.includes(`db.${projectRef}.supabase.co`)
      ) {
        console.warn("\nDirect IPv6 connection unreachable (ENETUNREACH).");
        console.log("Switching automatically to Supabase IPv4 Pooler (eu-west-1)...");
        await sql.end({ timeout: 1 }).catch(() => {});
        const parsed = new URL(dbUrl);
        const pass = parsed.password;
        dbUrl = `postgresql://postgres.${projectRef}:${pass}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
        sql = postgres(dbUrl, {
          ssl: { rejectUnauthorized: false },
          max: 1,
          connect_timeout: 10,
        });
        [test] = await sql`SELECT current_database(), current_user`;
        console.log("✓ Connected via IPv4 pooler!");
      } else {
        throw connErr;
      }
    }
    console.log(`Connected to database "${test.current_database}" as user "${test.current_user}"\n`);

    if (customFile) {
      const targetPath = path.resolve(process.cwd(), customFile);
      if (!fs.existsSync(targetPath)) {
        console.error(`File not found: ${targetPath}`);
        process.exit(1);
      }
      console.log(`Executing file: ${customFile}...`);
      const content = fs.readFileSync(targetPath, "utf-8");
      const startTime = Date.now();
      await sql.unsafe(content);
      console.log(`✓ Executed ${customFile} in ${Date.now() - startTime}ms`);
    } else {
      // Ensure migrations tracking table exists
      await sql`
        CREATE TABLE IF NOT EXISTS public._schema_migrations (
          name text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        );
      `;

      const appliedRows = await sql<{ name: string }[]>`
        SELECT name FROM public._schema_migrations ORDER BY name ASC;
      `;
      const appliedSet = new Set(appliedRows.map((r) => r.name));

      const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
      if (!fs.existsSync(migrationsDir)) {
        console.error(`Migrations directory not found at ${migrationsDir}`);
        process.exit(1);
      }

      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();

      console.log(`Found ${files.length} migration file(s):`);
      for (const f of files) {
        const isApplied = appliedSet.has(f);
        console.log(`  - ${f} [${isApplied ? "ALREADY APPLIED" : "PENDING"}]`);
      }

      let appliedCount = 0;

      for (const file of files) {
        if (appliedSet.has(file)) {
          continue;
        }

        const filePath = path.join(migrationsDir, file);
        const sqlContent = fs.readFileSync(filePath, "utf-8");

        console.log(`\nApplying migration: ${file}...`);
        const startTime = Date.now();

        await sql.unsafe(sqlContent);

        await sql`
          INSERT INTO public._schema_migrations (name)
          VALUES (${file})
          ON CONFLICT (name) DO UPDATE SET applied_at = now();
        `;

        const duration = Date.now() - startTime;
        console.log(`✓ Successfully applied ${file} in ${duration}ms`);
        appliedCount++;
      }

      console.log("\n========================================================");
      if (appliedCount > 0) {
        console.log(`SUCCESS: ${appliedCount} migration(s) applied successfully.`);
      } else {
        console.log("SUCCESS: Database schema is already up to date.");
      }
      console.log("========================================================\n");
    }

    // Check & verify super admin
    const superAdminEmail = "nasa-superadmin@nasa.com";
    try {
      const promoteResult = await sql`
        UPDATE public.profiles
        SET role = 'super_admin'
        WHERE email = ${superAdminEmail}
        RETURNING id, full_name, email, role;
      `;
      if (promoteResult.length > 0) {
        console.log(`[SUPER ADMIN] Verified & promoted ${superAdminEmail} to super_admin!`);
      }
    } catch {
      // profiles table might not exist yet if only partial DDL was run
    }

  } catch (err: unknown) {
    const errObj = err as { code?: string; message?: string };
    console.error("\n[ERROR] Migration failed:", errObj?.message || String(err));
    if (errObj?.code) console.error(`Error Code: ${errObj.code}`);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
