import type { NextConfig } from "next";

const isGitHubActions = process.env.GITHUB_ACTIONS === "true";

const nextConfig: NextConfig = {
  output: "export",
  // The git-pinned package ships source only; tsconfig "paths" points its entry at src/.
  transpilePackages: ["@moritzbrantner/tables"],
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  basePath: isGitHubActions ? "/collision-lab" : "",
  assetPrefix: isGitHubActions ? "/collision-lab/" : undefined,
};

export default nextConfig;
