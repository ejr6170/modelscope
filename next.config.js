import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  reactStrictMode: true,
  output: "export",
  distDir: "out",
  assetPrefix: "./",
  images: { unoptimized: true },
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
