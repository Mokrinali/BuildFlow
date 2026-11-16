"use client";

import { usePathname, useRouter } from "next/navigation";

export function ProjectSwitcher({ projects }: { projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const current = /^\/projects\/([^/]+)/.exec(pathname)?.[1] ?? "";

  if (projects.length === 0) {
    return <span className="text-sm text-steel-600">პროექტები არ არის</span>;
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor="project-switcher" className="text-sm font-medium">
        პროექტი
      </label>
      <select
        id="project-switcher"
        value={current}
        onChange={(e) => router.push(e.target.value ? `/projects/${e.target.value}` : "/projects")}
        className="min-h-10 max-w-[14rem] min-w-0 rounded-md border border-steel bg-white px-2 text-sm"
      >
        <option value="">ყველა პროექტი</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
