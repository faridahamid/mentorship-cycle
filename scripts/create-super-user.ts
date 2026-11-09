import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

// Load environment variables from .env.local or .env
function loadEnv() {
  for (const file of [".env.local", ".env", ".env.example"]) {
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

async function main() {
  loadEnv();

  const email = process.argv[2] || process.env.SUPER_ADMIN_EMAIL;
  const password = process.argv[3] || process.env.SUPER_ADMIN_PASSWORD;
  const fullName = process.argv[4] || process.env.SUPER_ADMIN_NAME || "Super Admin";

  if (!email || !password) {
    console.log(`
Usage:
  npx tsx scripts/create-super-user.ts <email> <password> [fullName]

Example:
  npx tsx scripts/create-super-user.ts admin@spaceapps.cairo MySecurePassword123 "NASA Admin"

Alternatively, you can provide SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in your environment.
`);
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey || serviceRoleKey === "your-service-role-key") {
    console.error(`
[ERROR] Missing Supabase credentials!
Please ensure your .env.local file contains:
  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=eyJh... (found in Supabase Dashboard -> Project Settings -> API -> service_role secret)

Alternatively, you can run this SQL query directly in your Supabase SQL Editor:

-- 1. Create the user in auth.users (if not already signed up) or sign up via /login or /register/mentor
-- 2. Promote the user's profile to super_admin:
UPDATE public.profiles
SET role = 'super_admin'
WHERE email = '${email}';
`);
    process.exit(1);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Connecting to Supabase at: ${supabaseUrl}`);
  console.log(`Target Super Admin: ${email} (${fullName})`);

  // Check if user already exists
  const { data: userList, error: listError } = await adminClient.auth.admin.listUsers();
  if (listError) {
    console.error("Error connecting to Supabase Auth:", listError.message);
    process.exit(1);
  }

  const existingUser = userList.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  let userId: string;

  if (existingUser) {
    console.log(`Found existing user with id: ${existingUser.id}`);
    userId = existingUser.id;

    // Update password & metadata if requested
    const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
      password,
      user_metadata: { full_name: fullName },
      email_confirm: true,
    });
    if (updateError) {
      console.error("Failed to update user auth record:", updateError.message);
      process.exit(1);
    }
  } else {
    console.log("Creating new user in auth.users...");
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError || !newUser.user) {
      console.error("Failed to create user:", createError?.message);
      process.exit(1);
    }

    userId = newUser.user.id;
    console.log(`Created user with id: ${userId}`);
  }

  // Ensure profile has role 'super_admin'
  console.log("Setting role to 'super_admin' in public.profiles...");
  
  // Wait a fraction of a second for handle_new_user trigger if freshly created
  await new Promise((r) => setTimeout(r, 400));

  const { data: updatedProfile, error: profileError } = await adminClient
    .from("profiles")
    .upsert({
      id: userId,
      email,
      full_name: fullName,
      role: "super_admin",
    })
    .select()
    .single();

  if (profileError) {
    console.error("Failed to update profile role:", profileError.message);
    process.exit(1);
  }

  console.log("\n========================================================");
  console.log("SUCCESS! Super user created & promoted successfully.");
  console.log(`Email:     ${updatedProfile.email}`);
  console.log(`Full Name: ${updatedProfile.full_name}`);
  console.log(`Role:      ${updatedProfile.role}`);
  console.log("========================================================\n");
  console.log("You can now sign in at /login with these credentials.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

