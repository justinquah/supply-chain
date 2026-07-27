import { requireRole, createClient } from "@/lib/supabase/server";
import { LaunchCalendar, type CalendarProject } from "./launch-calendar";
import { NpdManager, type Category, type NpdProject } from "./npd-manager";
import { dossierProgress } from "./constants";

// Asia/KL "today" for the calendar's initial month and today highlight.
function klTodayInfo(): { year: number; month: number; todayIso: string } {
  // en-CA gives ISO-style YYYY-MM-DD.
  const todayIso = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
  });
  const [year, month] = todayIso.split("-").map(Number);
  return { year, month: month - 1, todayIso };
}

export default async function DevelopmentPage() {
  // Gate: NPD is SCM/ADMIN territory (matches RLS on the npd_* tables).
  await requireRole("SCM", "ADMIN");

  const supabase = await createClient();

  const [{ data: projectRows }, { data: categoryRows }] = await Promise.all([
    supabase
      .from("npd_projects")
      .select(
        "id, name, category_id, target_launch_date, status, notes, spie_applicable, " +
          "product_categories(id, name), " +
          "npd_variations(id, name, usp, key_benefit, rp_price, rsp_price, pack_size, notes, created_at), " +
          "npd_checklist(id, stage, done, done_at, target_date), " +
          "npd_documents(id, doc_type, file_path, file_name, uploaded_at)"
      )
      // Soonest launch first; undated projects last.
      .order("target_launch_date", { ascending: true, nullsFirst: false }),
    supabase.from("product_categories").select("id, name").order("name"),
  ]);

  const projects = (projectRows ?? []) as unknown as NpdProject[];

  // Stable variation order (creation order) regardless of edit recency.
  for (const p of projects) {
    p.npd_variations?.sort((a, b) =>
      (a.created_at ?? "").localeCompare(b.created_at ?? "")
    );
  }

  const categories = (categoryRows ?? []) as Category[];
  const { year, month, todayIso } = klTodayInfo();

  // Calendar shows ACTIVE + LAUNCHED projects (on-hold/cancelled stay off it).
  const calendarProjects: CalendarProject[] = projects
    .filter((p) => p.status === "ACTIVE" || p.status === "LAUNCHED")
    .map((p) => {
      const dossier = dossierProgress(
        p.npd_documents ?? [],
        p.spie_applicable
      );
      return {
        id: p.id,
        name: p.name,
        category: p.product_categories?.name ?? null,
        date: p.target_launch_date,
        doneCount: (p.npd_checklist ?? []).filter((c) => c.done).length,
        dossierDone: dossier.done,
        dossierTotal: dossier.total,
        status: p.status as "ACTIVE" | "LAUNCHED",
      };
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          New Product Development (NPD)
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Track every new product from formulation to launch.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Launch calendar</h2>
        <LaunchCalendar
          projects={calendarProjects}
          initialYear={year}
          initialMonth={month}
          todayKl={todayIso}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">NPD projects</h2>
        <NpdManager projects={projects} categories={categories} />
      </section>
    </div>
  );
}
