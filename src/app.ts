import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Request, Response } from "express";
import { postStripeWebhook } from "./controllers/webhook.controller";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import routes from "./routes";

const app = express();

// Render terminates TLS at a proxy; trust one hop so req.ip (rate limiting)
// and secure cookies use the real client values.
app.set("trust proxy", 1);

app.use(cors({ origin: env.CLIENT_URL, credentials: true }));

// Must be mounted before express.json(): Stripe signature verification
// needs the exact raw request bytes, and a JSON body-parser would already
// have consumed/reserialized the body by the time this route saw it.
app.post("/webhooks/stripe", express.raw({ type: "application/json" }), postStripeWebhook);

app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.use(routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
