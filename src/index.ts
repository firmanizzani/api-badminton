import { app } from "./app";
import { env } from "./config/env";

app.listen({ port: env.PORT, hostname: "0.0.0.0" }, () => {
  console.log(`SMASH ARENA API → http://localhost:${env.PORT}`);
});
