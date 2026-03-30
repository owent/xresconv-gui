const fs = require("fs");
const path = require("path");

const baseDir = path.join(
  __dirname,
  "..",
  "node_modules",
  "jquery.fancytree",
  "dist"
);
const files = [
  "modules/jquery.fancytree.js",
  "jquery.fancytree-all-deps.js",
  "jquery.fancytree-all.js",
  "jquery.fancytree.min.js",
  "jquery.fancytree-all.min.js",
  "jquery.fancytree-all-deps.min.js",
];

let patched = 0;
for (const file of files) {
  const filePath = path.join(baseDir, file);
  if (!fs.existsSync(filePath)) continue;
  let content = fs.readFileSync(filePath, "utf8");
  const count = (content.match(/\.parseJSON\(/g) || []).length;
  if (count > 0) {
    content = content.replace(/\.parseJSON\(/g, ".parse(");
    fs.writeFileSync(filePath, content, "utf8");
    patched += count;
  }
}

if (patched > 0) {
  console.log(`Patched ${patched} $.parseJSON -> JSON.parse in fancytree`);
} else {
  console.log("No $.parseJSON found in fancytree (already patched or N/A)");
}
