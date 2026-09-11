import app from "./app";
import { env } from "./config/env";
import "./workers/mail.worker";

app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});
