// Supabase (PostgREST) caps every response at 1,000 rows and silently drops
// the rest. Any query that can grow past that — e.g. all of monthly_sales —
// must page through it. `page(from, to)` should build the query with a stable
// .order(...) and finish with .range(from, to).
export const SUPABASE_PAGE_SIZE = 1000;

export async function fetchAll<T>(
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await page(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) return { data: out, error };
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < SUPABASE_PAGE_SIZE) return { data: out, error: null };
  }
}
