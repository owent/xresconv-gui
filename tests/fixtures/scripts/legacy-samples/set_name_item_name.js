// set_name 样本：从表格文件名和 scheme 派生显示名称。
// name from the item's file basename and scheme. Runs synchronously once per
// item; item_data is a live reference — assignments are what the tree shows
// (tests/fixtures/scripts/contract.md ). data is per-item scratch space and
// must NOT leak into the next item.
var base = item_data.file == null ? "" : String(item_data.file);
var slash = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"));
if (slash >= 0) {
  base = base.slice(slash + 1);
}
item_data.name = base + " | " + (item_data.scheme == null ? "" : String(item_data.scheme));
log_info("set_name -> " + item_data.name);
