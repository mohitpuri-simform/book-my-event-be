import app from "./app";
import { env } from "./config/env";
import "./workers/mail.worker";
import "./workers/holdExpiry.worker";

app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});
