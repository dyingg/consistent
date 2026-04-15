import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import * as schema from "./schema/index.js";

const {
  user,
  goals,
  tasks,
  taskDependencies,
  scheduledBlocks,
  scheduleRuns,
} = schema;

async function seed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const db = drizzle(pool, { schema });

  console.log("Seeding database...\n");

  // Clean up existing seed data (reverse FK order)
  console.log("Cleaning up existing data...");
  await db.delete(scheduledBlocks);
  await db.delete(scheduleRuns);
  await db.delete(taskDependencies);
  await db.delete(tasks);
  await db.delete(goals);
  // Don't delete auth users — they may have sessions

  // 1. Ensure a seed user exists
  const existingUser = await db
    .select()
    .from(user)
    .where(eq(user.id, "seed-user-001"))
    .limit(1);

  let seedUser = existingUser[0];
  if (!seedUser) {
    const [created] = await db
      .insert(user)
      .values({
        id: "seed-user-001",
        name: "Ada Lovelace",
        email: "ada@example.com",
        emailVerified: true,
        timezone: "America/New_York",
        preferences: {
          workingHours: { start: "09:00", end: "17:00" },
          maxTasksPerDay: 6,
          defaultBlockDurationMin: 60,
        },
      })
      .returning();
    seedUser = created!;
  } else {
    // Update with domain columns
    await db
      .update(user)
      .set({
        timezone: "America/New_York",
        preferences: {
          workingHours: { start: "09:00", end: "17:00" },
          maxTasksPerDay: 6,
          defaultBlockDurationMin: 60,
        },
      })
      .where(eq(user.id, "seed-user-001"));
  }

  const userId = seedUser.id;
  console.log(`User: ${userId} (${seedUser.email})`);

  // 2. Create 2 goals with distinct hex colors
  const [goal1] = await db
    .insert(goals)
    .values({
      userId,
      title: "Learn Rust",
      description: "Complete the Rust book and build a project",
      descriptionContext:
        "Systems programming skill for performance-critical backend services",
      color: "#7F77DD",
      priority: 2,
    })
    .returning();

  const [goal2] = await db
    .insert(goals)
    .values({
      userId,
      title: "Ship MVP",
      description: "Launch the first version of the product",
      descriptionContext:
        "Critical path to revenue — design, build API, deploy",
      color: "#4ECDC4",
      priority: 1,
    })
    .returning();

  console.log(`Goals: "${goal1!.title}" (id=${goal1!.id}), "${goal2!.title}" (id=${goal2!.id})`);

  // 3. Create 8 tasks across both goals (5 for goal1, 3 for goal2)
  const taskData = [
    // Goal 1: Learn Rust
    {
      userId,
      goalId: goal1!.id,
      title: "Read chapters 1-4",
      description: "Basics, ownership, structs",
      estimatedMinutes: 120,
      priority: 2 as const,
    },
    {
      userId,
      goalId: goal1!.id,
      title: "Read chapters 5-8",
      description: "Enums, collections, error handling",
      estimatedMinutes: 120,
      priority: 2 as const,
    },
    {
      userId,
      goalId: goal1!.id,
      title: "Complete ownership exercises",
      description: "Rustlings exercises on borrowing and lifetimes",
      estimatedMinutes: 90,
      priority: 3 as const,
    },
    {
      userId,
      goalId: goal1!.id,
      title: "Build a CLI tool",
      description: "Small grep clone using clap + regex",
      estimatedMinutes: 180,
      priority: 3 as const,
    },
    {
      userId,
      goalId: goal1!.id,
      title: "Write blog post about Rust",
      description: "Reflections on learning Rust from a TS background",
      estimatedMinutes: 60,
      priority: 4 as const,
    },
    // Goal 2: Ship MVP
    {
      userId,
      goalId: goal2!.id,
      title: "Design database schema",
      description: "ERD + Drizzle schema files",
      estimatedMinutes: 120,
      priority: 1 as const,
    },
    {
      userId,
      goalId: goal2!.id,
      title: "Build API endpoints",
      description: "CRUD for goals, tasks, scheduling",
      estimatedMinutes: 240,
      priority: 1 as const,
    },
    {
      userId,
      goalId: goal2!.id,
      title: "Deploy to production",
      description: "Fly.io for API, Vercel for web",
      estimatedMinutes: 60,
      priority: 1 as const,
    },
  ];

  const insertedTasks = await db.insert(tasks).values(taskData).returning();
  console.log(
    `Tasks: ${insertedTasks.map((t) => `"${t.title}" (id=${t.id})`).join(", ")}`,
  );

  // 4. Create dependency edges forming a DAG
  // Goal 1 chain (length 3): chapters 1-4 → chapters 5-8 → exercises → CLI tool
  // Goal 2 chain: design schema → build API → deploy
  const t = insertedTasks;
  const deps = [
    // t[1] (chapters 5-8) depends on t[0] (chapters 1-4)
    { taskId: t[1]!.id, dependsOnId: t[0]!.id },
    // t[2] (exercises) depends on t[1] (chapters 5-8)
    { taskId: t[2]!.id, dependsOnId: t[1]!.id },
    // t[3] (CLI tool) depends on t[2] (exercises) — chain of length 3
    { taskId: t[3]!.id, dependsOnId: t[2]!.id },
    // t[6] (Build API) depends on t[5] (Design schema)
    { taskId: t[6]!.id, dependsOnId: t[5]!.id },
    // t[7] (Deploy) depends on t[6] (Build API)
    { taskId: t[7]!.id, dependsOnId: t[6]!.id },
  ];

  for (const dep of deps) {
    await db.insert(taskDependencies).values(dep);
  }
  console.log(`Dependencies: ${deps.length} edges\n`);

  // 5. Verify trigger-maintained counters
  console.log("=== Verification ===\n");

  const goal1Check = await db
    .select()
    .from(goals)
    .where(eq(goals.id, goal1!.id))
    .limit(1);
  const goal2Check = await db
    .select()
    .from(goals)
    .where(eq(goals.id, goal2!.id))
    .limit(1);

  console.log(
    `Goal "${goal1Check[0]!.title}": totalTasks=${goal1Check[0]!.totalTasks}, completedTasks=${goal1Check[0]!.completedTasks}`,
  );
  console.log(
    `Goal "${goal2Check[0]!.title}": totalTasks=${goal2Check[0]!.totalTasks}, completedTasks=${goal2Check[0]!.completedTasks}`,
  );

  const allTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.userId, userId));

  console.log("\nTask blocker counts:");
  for (const task of allTasks) {
    console.log(
      `  "${task.title}": blockerCount=${task.blockerCount}, status=${task.status}`,
    );
  }

  const readyTasks = allTasks.filter(
    (task) => task.blockerCount === 0 && task.status === "pending",
  );
  console.log(
    `\nReady tasks (blockerCount=0, status=pending): ${readyTasks.map((t) => `"${t.title}"`).join(", ")}`,
  );

  await pool.end();
  console.log("\nDone.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
