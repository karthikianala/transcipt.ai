import { serve } from "@hono/node-server";
import { env } from "@my-better-t-app/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import chunksRoute from "./routes/chunks";
import sessionsRoute from "./routes/sessions";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.get("/", (c) => c.text("OK"));

app.route("/api/sessions", sessionsRoute);
app.route("/api/chunks", chunksRoute);

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`Server listening on http://localhost:${info.port}`);
  },
);
