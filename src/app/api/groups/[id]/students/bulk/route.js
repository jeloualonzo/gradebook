import { bulkAddGroupStudents } from '@/lib/queries/groups';

// Bulk-add students to a group (Excel import).
// Body: { students: [{ first_name, middle_name, last_name }] }
// Duplicates within the group (same full name, case-insensitive) are skipped.
// Returns { added, skipped }.
export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const { students } = await request.json();
    if (!Array.isArray(students)) {
      return Response.json({ error: 'students must be an array' }, { status: 400 });
    }
    const result = await bulkAddGroupStudents(resolvedParams.id, students);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
