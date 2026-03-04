import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { existsSync, createReadStream } from "fs";
import { join } from "path";

export default defineConfig({
  base: "/redactedclub/",
  plugins: [
    {
      name: "serve-nft-images",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const idx = req.url?.indexOf("/allBunnies/");
          if (idx !== undefined && idx !== -1) {
            const relativePath = decodeURIComponent(req.url.slice(idx));
            const filePath = join(process.cwd(), relativePath);
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
    viteStaticCopy({
      targets: [
        {
          src: "allBunnies",
          dest: ".",
        },
      ],
    }),
  ],
});
