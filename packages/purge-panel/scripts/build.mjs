import { build } from "esbuild";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const community = process.argv.includes("--community");
const projectRoot = path.resolve(root, "../..");
const pkg = JSON.parse(
  await fs.readFile(
    path.join(community ? projectRoot : root, "package.json"),
    "utf8",
  ),
);
const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/entry.js"],
  bundle: true,
  write: false,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  external: ["react", "react-dom"],
  treeShaking: true,
  legalComments: "inline",
  loader: { ".css": "text" },
  define: {
    __PANEL_VERSION__: JSON.stringify(pkg.version),
    __COMMUNITY__: JSON.stringify(community),
  },
});
// 源码在 Windows 检出时是 CRLF，esbuild 把 CSS 当文本内联后会把 \r\n 带进包体，
// 导致同一份源码在不同换行设置下产出不同 bundle（--check 会误报 stale）。
// 统一归一化成 LF，让构建结果与检出方式无关。
const bundleText = result.outputFiles[0].text.replace(/\r\n/g, "\n");
const output =
  "// Generated from src/ by npm run build. Do not edit.\n" +
  "// Derived UI: YuJunZhiXue/dsh-purge (MIT), see LICENSE.\n" +
  "window.__ModuleLoader__.load({id:" +
  JSON.stringify(pkg.name) +
  ",factory:(require)=>{\n" +
  "var module={exports:{}};var exports=module.exports;\n" +
  bundleText +
  "\nreturn module.exports;\n}});\n";
const dest = path.join(community ? projectRoot : root, "client.js");
if (process.argv.includes("--check")) {
  if ((await fs.readFile(dest, "utf8")) !== output)
    throw new Error(
      "client.js is stale; run npm run build and commit the output.",
    );
  console.log("PASS: checked-in bundle matches source");
} else {
  await fs.writeFile(dest, output);
  console.log(
    `Built ${pkg.name}@${pkg.version}: ${Buffer.byteLength(output)} bytes`,
  );
}
