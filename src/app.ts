import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Request, Response } from "express";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import routes from "./routes";

const app = express();

app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.use(routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
