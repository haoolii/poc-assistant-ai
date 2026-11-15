import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { agentRoutes } from "./routes/agent.js";
import { getCase } from "./lib/case-store.js";

const app = Fastify({
  logger: true,
  requestTimeout: 0,
  connectionTimeout: 0,
  keepAliveTimeout: 72_000,
});

await app.register(cors, { origin: "http://localhost:5173" });
app.get("/health", async () => ({ status: "ok" }));
app.get<{ Params: { caseId: string } }>("/cases/:caseId", async (request, reply) => {
  const item = getCase(request.params.caseId);
  return item ?? reply.code(404).send({ error: "Case not found" });
});
await app.register(agentRoutes);

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
