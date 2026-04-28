/** @type {import('next').NextConfig} */
// Static export for GitHub Pages.
// Repo path is /Investor, so production assets live at <user>.github.io/Investor/.
// GH_PAGES=1 is set by the GitHub Actions workflow. Local builds and `npm run dev`
// run without a basePath so http://localhost:3000/ works directly.
const isPages = process.env.GH_PAGES === "1";

const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  basePath: isPages ? "/Investor" : "",
  assetPrefix: isPages ? "/Investor/" : "",
  // Service worker headers don't apply to a static export; the SW is served as
  // a regular file by GitHub Pages.
};
export default nextConfig;
