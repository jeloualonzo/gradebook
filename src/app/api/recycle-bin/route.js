import db from '@/lib/db';
import { getDeletedSubjects } from '@/lib/queries/subjects';
import { getDeletedGroups } from '@/lib/queries/groups';

/** Resolve a device id to a friendly label for display. */
function deviceLabelResolver() {
  const config = db.getDeviceConfig();
  return (deviceId) => {
    if (!deviceId) return null;
    if (deviceId === config.device_id) return config.device_label || 'This laptop';
    return config.peers?.[deviceId]?.label || 'Other laptop';
  };
}

// Recently deleted subjects and student groups (tombstoned, not purged).
export async function GET() {
  try {
    const label = deviceLabelResolver();
    const subjects = (await getDeletedSubjects()).map(s => ({
      id: s.id,
      name: s.name,
      section: s.section,
      school_year: s.school_year,
      semester: s.semester,
      deleted_at: s.deleted_at,
      deleted_by: label(s.deleted_by_device_id),
      student_count: s.student_count,
      score_count: s.score_count,
    }));
    const groups = (await getDeletedGroups()).map(g => ({
      id: g.id,
      name: g.name,
      description: g.description,
      deleted_at: g.deleted_at,
      deleted_by: label(g.deleted_by_device_id),
      member_count: g.member_count,
    }));
    return Response.json({ subjects, groups });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
