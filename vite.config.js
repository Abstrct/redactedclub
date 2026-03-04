import { defineConfig } from "vite";
import { existsSync, createReadStream } from "fs";
import { join } from "path";

export default defineConfig({
  plugins: [
    {
      name: "serve-nft-images",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith("/allBunnies/")) {
            const filePath = join(process.cwd(), decodeURIComponent(req.url));
            if (existsSync(filePath)) {
              res.setHeader("Content-Type", "image/webp");
              res.setHeader("Cache-Control", "public, max-age=86400");
              createReadStream(filePath).pipe(res);
              return;
            }
          }
          next();
        });
      },
    },
  ],
});
