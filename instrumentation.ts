export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAllListeners } = await import("./src/server/listener/listener-service");
    const port = parseInt(process.env.PORT || "3000", 10);
    startAllListeners(port);
  }
}
