import { recentConflicts } from '@/lib/sync';

// The most recent conflicts sync has resolved (newest-wins) on THIS laptop —
// every entry is a value that was replaced here after both laptops edited
// the same thing. Read-only; shown in the Sync dialog.
export async function GET() {
  try {
    return Response.json({ conflicts: recentConflicts(20) });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
