export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { database } = await import("./lib/db");
  await database();
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
}
