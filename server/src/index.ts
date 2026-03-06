import { createApp } from "./app.js";
import { config } from "./config.js";
import "./db/database.js";

const apiApp = createApp();
apiApp.listen(config.port, () => {
  console.log(`API server listening on http://127.0.0.1:${config.port}`);
});
