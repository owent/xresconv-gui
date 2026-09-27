/** 本地图形，无字体或网络资源依赖；可访问名称由所在控件提供。 */
export function Icon({ name }: { name: "app" | "file" | "search" | "play" | "log" | "settings" }) {
  const paths = {
    app: "M4 3h10l6 6v12H4V3Zm10 0v6h6M8 13h8M8 17h5",
    file: "M3 7h7l2 2h9l-2 11H3V7Zm0 0V4h7l2 3h7v2",
    search: "m20 20-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
    play: "m8 4 12 8-12 8V4Z",
    log: "m4 6 5 5-5 5m9 1h7",
    settings: "M4 7h16M4 17h16M9 4v6m6 4v6",
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
